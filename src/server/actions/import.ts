"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { computeHoldings } from "@/lib/cap-math";
import { clientInfo } from "@/lib/request";
import { authorize } from "@/lib/session";
import { dbError, fail, ok, parseForm, type ActionResult } from "@/lib/action";
import { postedLedger } from "../captable";
import { readCsv, validateInvestors, validateTxns } from "../import";
import { LEDGER_LOCK, syncStages } from "../ledger";

async function fileBytes(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return null;
  return Buffer.from(await f.arrayBuffer());
}

/** Bước 1 "Kiểm tra" chỉ đọc; bước 2 "Nhập" chỉ chạy khi file KHÔNG có dòng lỗi nào (tất cả hoặc không gì cả). */
export async function importInvestorsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("data.import");
  if ("error" in u) return fail(u.error);
  const bytes = await fileBytes(fd);
  if (!bytes) return fail("Chưa chọn file CSV.");
  const csv = readCsv(bytes);
  if ("error" in csv) return fail(csv.error);
  const v = await validateInvestors(csv.recs);
  if (fd.get("mode") !== "commit" || v.errors > 0) {
    return { ok: v.errors === 0, message: v.errors ? `${v.errors} dòng lỗi — sửa file rồi kiểm tra lại.` : `${v.rows.length} dòng hợp lệ. Bấm "Nhập" để lưu.`, rows: v.rows };
  }
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const last = await tx.investor.findFirst({ orderBy: { code: "desc" }, select: { code: true } });
      let n = last ? Number(last.code.replace(/\D/g, "")) : 0;
      for (const inv of v.valid) {
        n += 1;
        const created = await tx.investor.create({ data: { ...inv, code: `INV-${String(n).padStart(4, "0")}` } });
        await tx.stageChange.create({ data: { investorId: created.id, to: inv.stage, byId: u.id, note: "Import CSV" } });
      }
      await audit({ actorId: u.id, actorEmail: u.email, action: "import.investors", ip, data: { count: v.valid.length } }, tx);
    }, { timeout: 60_000 });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/investors");
  return ok(`Đã nhập ${v.valid.length} nhà đầu tư.`);
}

export async function importTxnsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("data.import");
  if ("error" in u) return fail(u.error);
  const bytes = await fileBytes(fd);
  if (!bytes) return fail("Chưa chọn file CSV.");
  const csv = readCsv(bytes);
  if ("error" in csv) return fail(csv.error);
  const v = await validateTxns(csv.recs);
  if (fd.get("mode") !== "commit" || v.errors > 0) {
    return { ok: v.errors === 0, message: v.errors ? `${v.errors} dòng lỗi — sửa file rồi kiểm tra lại.` : `${v.rows.length} giao dịch hợp lệ. Bấm "Nhập" để tạo lô nháp.`, rows: v.rows };
  }
  const batch = `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      for (const t of v.valid) {
        const { line, pricePerShare, amount, currency, ...rest } = t;
        void line;
        // Người không có quyền xem tiền: bỏ qua các cột tiền trong file.
        const money = u.seeMoney ? { pricePerShare, amount, currency } : {};
        await tx.shareTransaction.create({ data: { ...rest, ...money, importBatch: batch, createdById: u.id } });
      }
      await audit({ actorId: u.id, actorEmail: u.email, action: "import.transactions", ip, data: { batch, count: v.valid.length } }, tx);
    }, { timeout: 60_000 });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/import");
  revalidatePath("/transactions");
  return ok(`Đã tạo lô ${batch} gồm ${v.valid.length} giao dịch nháp. Cần một người khác có quyền ghi sổ duyệt cả lô.`);
}

/** Ghi sổ cả lô trong MỘT transaction: một dòng lỗi thì cả lô không vào sổ. Vẫn maker–checker. */
export async function postBatchAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("txn.post");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ batch: z.string().regex(/^IMP-\d{8}-[0-9A-F]{6}$/) }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  try {
    const msg = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`;
      const items = await tx.shareTransaction.findMany({ where: { importBatch: p.data.batch, status: "DRAFT" }, orderBy: { seq: "asc" } });
      if (items.length === 0) return "Lô không còn giao dịch nháp.";
      if (items.some((t) => t.createdById === u.id)) return "Maker–checker: bạn không thể duyệt lô do chính mình nhập.";
      try {
        computeHoldings([...(await postedLedger(tx)), ...items]);
      } catch (e) {
        return e instanceof Error ? e.message : "Số dư không hợp lệ";
      }
      // Trigger DB vẫn kiểm tra maker–checker trên từng dòng.
      await tx.shareTransaction.updateMany({
        where: { id: { in: items.map((t) => t.id) }, status: "DRAFT" },
        data: { status: "POSTED", postedById: u.id, postedAt: new Date() },
      });
      const parties = items.flatMap((t) => [t.fromInvestorId, t.toInvestorId]).filter((x): x is string => Boolean(x));
      await syncStages(tx, parties, u.id);
      await audit({ actorId: u.id, actorEmail: u.email, action: "txn.post_batch", ip, data: { batch: p.data.batch, count: items.length } }, tx);
      return null;
    }, { timeout: 120_000 });
    if (msg) return fail(msg);
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/import");
  revalidatePath("/captable");
  revalidatePath("/transactions");
  return ok("Đã ghi sổ cả lô. Cap Table đã cập nhật.");
}

export async function cancelBatchAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("txn.create");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ batch: z.string().regex(/^IMP-\d{8}-[0-9A-F]{6}$/) }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  const r = await db.$transaction(async (tx) => {
    const res = await tx.shareTransaction.updateMany({ where: { importBatch: p.data.batch, status: "DRAFT" }, data: { status: "CANCELLED" } });
    await audit({ actorId: u.id, actorEmail: u.email, action: "txn.cancel_batch", ip, data: { batch: p.data.batch, count: res.count } }, tx);
    return res;
  });
  revalidatePath("/import");
  return ok(`Đã huỷ ${r.count} giao dịch nháp của lô.`);
}
