-- Giao dịch cổ phần chỉ được sinh ra ở trạng thái DRAFT. Muốn vào sổ phải qua UPDATE → POSTED,
-- nơi trigger guard_share_txn bắt buộc maker–checker. Chặn đường tắt INSERT thẳng một dòng POSTED.
CREATE OR REPLACE FUNCTION irhub.guard_share_txn_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'DRAFT' OR NEW."postedById" IS NOT NULL OR NEW."postedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Giao dịch mới phải ở trạng thái DRAFT (maker-checker)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER share_txn_insert_guard BEFORE INSERT ON irhub."ShareTransaction"
  FOR EACH ROW EXECUTE FUNCTION irhub.guard_share_txn_insert();
