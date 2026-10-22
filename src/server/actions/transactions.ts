"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { computeHoldings, grantSummary } from "@/lib/cap-math";
import { clientInfo } from "@/lib/request";
import { authorize } from "@/lib/session";
import { dbError, fail, ok, parseForm, zDate, zId, zMoney, zShares, zText, type ActionResult } from "@/lib/action";
import { postedLedger } from "../captable";
import { LEDGER_LOCK, syncStages } from "../ledger";

const txnSchema = z.object({
  kind: z.enum(["ISSUE", "TRANSFER", "REDEMPTION"]),
  date: zDate,
  shareClassId: zId,
  quantity: zShares,
  fromInvestorId: zId.optional(),
  toInvestorId: zId.optional(),
  roundId: zId.optional(),
  pricePerShare: zMoney.optional(),
  amount: zMoney.optional(),
  currency: z.enum(["VND", "USD", "SGD", "JPY", "KRW", "EUR"]).default("VND"),
  fxRate: zMoney.optional(),
  docRef: zText(120).optional(),
  note: zText(1000).optional(),
});

function checkParties(kind: string, from?: string, to?: string): string | null {
  if (kind === "ISSUE" && (!to || from)) return "Phát hành mới cần bên nhận, không có bên chuyển.";
  if (kind === "TRANSFER" && (!to || !from)) return "Chuyển nhượng cần cả bên chuyển và bên nhận.";
  if (kind === "TRANSFER" && to === from) return "Bên chuyển và bên nhận phải khác nhau.";
  if (kind === "REDEMPTION" && (!from || to)) return "Mua lại cần bên chuyển (cổ đông bị mua lại).";
  return null;
}

export async function createTxnAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("txn.create");
  if ("error" in u) return fail(u.error);
  const p = parseForm(txnSchema, fd);
  if ("error" in p) return fail(p.error);
  const d = p.data;
  const partyErr = checkParties(d.kind, d.fromInvestorId, d.toInvestorId);
  if (partyErr) return fail(partyErr);
  // Người không có quyền xem tiền cũng không được nhập trường tiền.
  const money = u.seeMoney
    ? { pricePerShare: d.pricePerShare, amount: d.amount, fxRate: d.fxRate, currency: d.currency }
    : {};
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const t = await tx.shareTransaction.create({
        data: {
          kind: d.kind,
          date: d.date,
          shareClassId: d.shareClassId,
          quantity: d.quantity,
          fromInvestorId: d.fromInvestorId ?? null,
          toInvestorId: d.toInvestorId ?? null,
          roundId: d.roundId ?? null,
          docRef: d.docRef,
          note: d.note,
          createdById: u.id,
          ...money,
        },
      });
      await audit({ actorId: u.id, actorEmail: u.email, action: "txn.create", entityType: "ShareTransaction", entityId: t.id, ip, data: { seq: t.seq, kind: t.kind, quantity: t.quantity } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/transactions");
  return ok("Đã tạo giao dịch nháp. Cần một người khác có quyền ghi sổ duyệt.");
}

export async function postTxnAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("txn.post");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  try {
    const msg = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`;
      const t = await tx.shareTransaction.findUniqueOrThrow({ where: { id: p.data.id } });
      if (t.status !== "DRAFT") return "Giao dịch không còn ở trạng thái nháp.";
      if (t.createdById === u.id) return "Maker–checker: bạn không thể tự duyệt giao dịch do chính mình tạo.";

      // Kiểm tra toàn vẹn: áp giao dịch này lên sổ hiện tại, âm cổ phần → computeHoldings ném lỗi.
      const ledger = await postedLedger(tx);
      try {
        computeHoldings([...ledger, { ...t, seq: Number.MAX_SAFE_INTEGER }]);
      } catch (e) {
        return e instanceof Error ? e.message.replace(/#\d+/, `#${t.seq}`) : "Số dư không hợp lệ";
      }

      if (t.esopGrantId) {
        const g = await tx.esopGrant.findUniqueOrThrow({
          where: { id: t.esopGrantId },
          include: { exercises: { where: { status: "POSTED" }, select: { quantity: true } } },
        });
        const done = g.exercises.reduce((a, e) => a + e.quantity, 0n);
        const s = grantSummary(g, done, new Date());
        if (t.quantity > s.exercisable) return `Chỉ còn ${s.exercisable} quyền đã vest có thể thực hiện.`;
      }
      if (t.convertibleId) {
        await tx.convertibleInstrument.update({ where: { id: t.convertibleId }, data: { status: "CONVERTED" } });
      }

      await tx.shareTransaction.update({
        where: { id: t.id },
        data: { status: "POSTED", postedById: u.id, postedAt: new Date() },
      });
      await syncStages(tx, [t.fromInvestorId, t.toInvestorId].filter((x): x is string => Boolean(x)), u.id);
      await audit({ actorId: u.id, actorEmail: u.email, action: "txn.post", entityType: "ShareTransaction", entityId: t.id, ip, data: { seq: t.seq, kind: t.kind, quantity: t.quantity } }, tx);
      return null;
    });
    if (msg) return fail(msg);
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/transactions");
  revalidatePath("/captable");
  return ok("Đã ghi sổ. Cap Table đã cập nhật.");
}

export async function cancelTxnAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("txn.create");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const t = await tx.shareTransaction.findUniqueOrThrow({ where: { id: p.data.id } });
      if (t.status !== "DRAFT") throw new Error("not_draft");
      await tx.shareTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
      await audit({ actorId: u.id, actorEmail: u.email, action: "txn.cancel", entityType: "ShareTransaction", entityId: t.id, ip, data: { seq: t.seq } }, tx);
    });
  } catch (e) {
    if (e instanceof Error && e.message === "not_draft") return fail("Chỉ huỷ được giao dịch nháp.");
    return dbError(e);
  }
  revalidatePath("/transactions");
  return ok("Đã huỷ giao dịch nháp.");
}

/** Sửa sai một giao dịch đã ghi sổ: tạo giao dịch đối ứng (nháp), cũng phải qua maker–checker. */
export async function reverseTxnAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("txn.create");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId, note: zText(500).min(5, "Ghi rõ lý do đảo") }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  try {
    const msg = await db.$transaction(async (tx) => {
      const t = await tx.shareTransaction.findUniqueOrThrow({ where: { id: p.data.id }, include: { reversedBy: true } });
      if (t.status !== "POSTED") return "Chỉ đảo được giao dịch đã ghi sổ.";
      if (t.reversesId) return "Không đảo một giao dịch đối ứng.";
      if (t.reversedBy) return "Giao dịch này đã có bút toán đối ứng.";
      if (t.esopGrantId || t.convertibleId) return "Giao dịch ESOP / chuyển đổi SAFE cần xử lý thủ công với Pháp chế.";
      const reverse =
        t.kind === "ISSUE"
          ? { kind: "REDEMPTION" as const, fromInvestorId: t.toInvestorId, toInvestorId: null }
          : t.kind === "REDEMPTION"
            ? { kind: "ISSUE" as const, fromInvestorId: null, toInvestorId: t.fromInvestorId }
            : { kind: "TRANSFER" as const, fromInvestorId: t.toInvestorId, toInvestorId: t.fromInvestorId };
      const r = await tx.shareTransaction.create({
        data: {
          ...reverse,
          date: new Date(),
          shareClassId: t.shareClassId,
          quantity: t.quantity,
          reversesId: t.id,
          note: `Đảo giao dịch #${t.seq}: ${p.data.note}`,
          createdById: u.id,
        },
      });
      await audit({ actorId: u.id, actorEmail: u.email, action: "txn.reverse", entityType: "ShareTransaction", entityId: r.id, ip, data: { reverses: t.seq } }, tx);
      return null;
    });
    if (msg) return fail(msg);
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/transactions");
  return ok("Đã tạo bút toán đối ứng (nháp) — cần người khác ghi sổ.");
}
