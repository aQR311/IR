-- Lớp bảo vệ ở tầng DB. Không phụ thuộc vào code app: kể cả có người chạy SQL tay, các ràng buộc này vẫn giữ.

-- 1) Audit log chỉ được ghi thêm.
CREATE OR REPLACE FUNCTION irhub.forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % chỉ cho phép ghi thêm (append-only)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON irhub."AuditLog"
  FOR EACH ROW EXECUTE FUNCTION irhub.forbid_change();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON irhub."AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION irhub.forbid_change();

-- 2) Sổ cái cổ phần: dòng đã ghi sổ (POSTED) / đã huỷ là bất biến; không bao giờ xoá.
CREATE OR REPLACE FUNCTION irhub.guard_share_txn() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Không được xoá giao dịch cổ phần — hãy huỷ nháp hoặc tạo giao dịch đối ứng';
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Giao dịch % đã % — bất biến', OLD.seq, OLD.status;
  END IF;
  IF NEW.status = 'POSTED' AND (NEW."postedById" IS NULL OR NEW."postedById" = NEW."createdById") THEN
    RAISE EXCEPTION 'Maker-checker: người ghi sổ phải khác người tạo giao dịch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER share_txn_guard BEFORE UPDATE OR DELETE ON irhub."ShareTransaction"
  FOR EACH ROW EXECUTE FUNCTION irhub.guard_share_txn();
CREATE TRIGGER share_txn_no_truncate BEFORE TRUNCATE ON irhub."ShareTransaction"
  FOR EACH STATEMENT EXECUTE FUNCTION irhub.forbid_change();

ALTER TABLE irhub."ShareTransaction"
  ADD CONSTRAINT share_txn_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT share_txn_parties CHECK (
    (kind = 'ISSUE'      AND "toInvestorId" IS NOT NULL AND "fromInvestorId" IS NULL) OR
    (kind = 'TRANSFER'   AND "toInvestorId" IS NOT NULL AND "fromInvestorId" IS NOT NULL
                         AND "toInvestorId" <> "fromInvestorId") OR
    (kind = 'REDEMPTION' AND "fromInvestorId" IS NOT NULL AND "toInvestorId" IS NULL)
  );

ALTER TABLE irhub."EsopPool"  ADD CONSTRAINT esop_pool_size_positive CHECK (size > 0);
ALTER TABLE irhub."EsopGrant" ADD CONSTRAINT esop_grant_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT esop_grant_vesting CHECK ("vestingMonths" > 0 AND "cliffMonths" >= 0 AND "cliffMonths" <= "vestingMonths");

-- 3) Phòng thủ chiều sâu cho Supabase: bật RLS (không có policy = chặn hết) trên mọi bảng,
--    và thu hồi quyền của các role Data API nếu chúng tồn tại. App kết nối bằng role chủ sở hữu.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'irhub' LOOP
    EXECUTE format('ALTER TABLE irhub.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA irhub FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA irhub FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA irhub FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA irhub FROM authenticated';
  END IF;
END $$;
