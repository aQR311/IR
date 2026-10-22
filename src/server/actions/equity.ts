"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientInfo } from "@/lib/request";
import { authorize } from "@/lib/session";
import { dbError, fail, ok, parseForm, zDate, zId, zMoney, zShares, zText, type ActionResult } from "@/lib/action";
import { esopState } from "../captable";

// ── ESOP

export async function createPoolAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("esop.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(
    z.object({ name: zText(100).min(2), shareClassId: zId, size: zShares, approvedAt: zDate, resolution: zText(120).optional() }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const pool = await tx.esopPool.create({ data: p.data });
      await audit({ actorId: u.id, actorEmail: u.email, action: "esop.pool.create", entityType: "EsopPool", entityId: pool.id, ip, data: { size: pool.size, resolution: pool.resolution } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/esop");
  return ok("Đã tạo / mở rộng bể ESOP.");
}

export async function createGrantAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("esop.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(
    z.object({
      code: z.string().regex(/^[A-Z0-9_-]{3,40}$/, "Mã chỉ gồm chữ in hoa, số, - _"),
      poolId: zId,
      holderId: zId,
      grantDate: zDate,
      quantity: zShares,
      exercisePrice: zMoney.optional(),
      vestingStart: zDate,
      cliffMonths: z.coerce.number().int().min(0).max(60),
      vestingMonths: z.coerce.number().int().min(1).max(120),
      frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
      docRef: zText(120).optional(),
    }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  if (p.data.cliffMonths > p.data.vestingMonths) return fail("Cliff không được dài hơn thời gian vesting.");
  const state = await esopState();
  if (p.data.quantity > state.pool.available) {
    return fail(`Bể ESOP chỉ còn ${state.pool.available.toLocaleString("vi-VN")} quyền chưa cấp.`);
  }
  const holder = await db.investor.findUnique({ where: { id: p.data.holderId }, select: { category: true } });
  if (holder?.category !== "EMPLOYEE" && holder?.category !== "FOUNDER") {
    return fail("ESOP chỉ cấp cho hồ sơ loại Nhân viên hoặc Sáng lập.");
  }
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const g = await tx.esopGrant.create({
        data: { ...p.data, exercisePrice: u.seeMoney ? (p.data.exercisePrice ?? 0) : 0 },
      });
      await audit({ actorId: u.id, actorEmail: u.email, action: "esop.grant.create", entityType: "EsopGrant", entityId: g.id, ip, data: { code: g.code, quantity: g.quantity } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/esop");
  return ok("Đã cấp quyền ESOP.");
}

export async function terminateGrantAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("esop.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId, terminatedAt: zDate }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  const g = await db.esopGrant.findUnique({ where: { id: p.data.id } });
  if (!g || g.status !== "ACTIVE") return fail("Chỉ chấm dứt được quyền đang hiệu lực.");
  await db.$transaction(async (tx) => {
    await tx.esopGrant.update({ where: { id: g.id }, data: { status: "TERMINATED", terminatedAt: p.data.terminatedAt } });
    await audit({ actorId: u.id, actorEmail: u.email, action: "esop.grant.terminate", entityType: "EsopGrant", entityId: g.id, ip, data: { terminatedAt: p.data.terminatedAt.toISOString() } }, tx);
  });
  revalidatePath("/esop");
  return ok("Đã chấm dứt — phần chưa vest được thu hồi về bể ESOP.");
}

/** Thực hiện quyền: tạo giao dịch PHÁT HÀNH nháp gắn với grant; Kế toán xác nhận thu tiền rồi ghi sổ. */
export async function exerciseGrantAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("esop.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId, quantity: zShares, date: zDate }), fd);
  if ("error" in p) return fail(p.error);
  const state = await esopState();
  const item = state.grants.find((x) => x.grant.id === p.data.id);
  if (!item) return fail("Không tìm thấy quyền ESOP.");
  const pending = await db.shareTransaction.aggregate({
    where: { esopGrantId: p.data.id, status: "DRAFT" },
    _sum: { quantity: true },
  });
  const free = item.summary.exercisable - (pending._sum.quantity ?? 0n);
  if (p.data.quantity > free) return fail(`Chỉ còn ${free.toLocaleString("vi-VN")} quyền có thể thực hiện.`);
  const pool = await db.esopPool.findUniqueOrThrow({ where: { id: item.grant.poolId } });
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const t = await tx.shareTransaction.create({
        data: {
          kind: "ISSUE",
          date: p.data.date,
          shareClassId: pool.shareClassId,
          quantity: p.data.quantity,
          toInvestorId: item.grant.holderId,
          esopGrantId: item.grant.id,
          pricePerShare: item.grant.exercisePrice,
          amount: item.grant.exercisePrice.mul(p.data.quantity.toString()),
          currency: "VND",
          note: `Thực hiện quyền ESOP ${item.grant.code}`,
          createdById: u.id,
        },
      });
      await audit({ actorId: u.id, actorEmail: u.email, action: "esop.exercise.request", entityType: "ShareTransaction", entityId: t.id, ip, data: { grant: item.grant.code, quantity: t.quantity } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/esop");
  revalidatePath("/transactions");
  return ok("Đã tạo yêu cầu thực hiện quyền (nháp). Kế toán xác nhận tiền về rồi ghi sổ.");
}

// ── SAFE / Convertible

export async function createConvertibleAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("convertibles.manage");
  if ("error" in u) return fail(u.error);
  if (!u.seeMoney) return fail("Cần quyền xem dữ liệu tiền để nhập khoản đầu tư chuyển đổi.");
  const p = parseForm(
    z.object({
      code: z.string().regex(/^[A-Z0-9_-]{3,40}$/, "Mã chỉ gồm chữ in hoa, số, - _"),
      investorId: zId,
      kind: z.enum(["SAFE_POST", "SAFE_PRE", "CONVERTIBLE_NOTE"]),
      principal: zMoney,
      currency: z.enum(["VND", "USD", "SGD", "JPY", "KRW", "EUR"]),
      valuationCap: zMoney.optional(),
      discountPct: zMoney.optional(),
      interestPct: zMoney.optional(),
      issueDate: zDate,
      maturityDate: zDate.optional(),
      docRef: zText(120).optional(),
      notes: zText(1000).optional(),
    }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  if (p.data.discountPct && p.data.discountPct.gte(100)) return fail("Chiết khấu phải < 100%.");
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const c = await tx.convertibleInstrument.create({ data: p.data });
      await audit({ actorId: u.id, actorEmail: u.email, action: "convertible.create", entityType: "ConvertibleInstrument", entityId: c.id, ip, data: { code: c.code, kind: c.kind } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/convertibles");
  return ok("Đã ghi nhận khoản đầu tư chuyển đổi.");
}
