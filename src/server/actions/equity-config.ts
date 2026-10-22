"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientInfo } from "@/lib/request";
import { authorize } from "@/lib/session";
import { dbError, fail, ok, parseForm, zDate, zId, zMoney, zText, type ActionResult } from "@/lib/action";

const zCode = z.string().regex(/^[A-Z0-9_]{2,30}$/, "Mã chỉ gồm chữ in hoa, số, dấu _");
const zDec = (max: number) => z.coerce.number().min(0).max(max);

const classFields = z.object({
  name: zText(120).min(2),
  votesPerShare: z.coerce.number().int().min(0).max(100),
  liquidationPrefX: zDec(10),
  seniority: z.coerce.number().int().min(0).max(20),
  participating: z.literal("on").optional(),
  notes: zText(1000).optional(),
});

export async function createShareClassAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("equity.configure");
  if ("error" in u) return fail(u.error);
  const p = parseForm(classFields.extend({ code: zCode, kind: z.enum(["COMMON", "PREFERRED"]), parValue: zMoney.optional() }), fd);
  if ("error" in p) return fail(p.error);
  const { participating, ...d } = p.data;
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const c = await tx.shareClass.create({ data: { ...d, participating: participating === "on", parValue: d.parValue ?? 10000 } });
      await audit({ actorId: u.id, actorEmail: u.email, action: "shareclass.create", entityType: "ShareClass", entityId: c.id, ip, data: { code: c.code, kind: c.kind } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/settings/equity");
  return ok("Đã tạo lớp cổ phần.");
}

/** Mã, loại và mệnh giá không đổi được sau khi tạo (đã gắn với giao dịch); chỉ sửa thuộc tính quyền. */
export async function updateShareClassAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("equity.configure");
  if ("error" in u) return fail(u.error);
  const p = parseForm(classFields.extend({ id: zId }), fd);
  if ("error" in p) return fail(p.error);
  const { id, participating, ...d } = p.data;
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const before = await tx.shareClass.findUniqueOrThrow({ where: { id } });
      await tx.shareClass.update({ where: { id }, data: { ...d, participating: participating === "on" } });
      await audit(
        { actorId: u.id, actorEmail: u.email, action: "shareclass.update", entityType: "ShareClass", entityId: id, ip,
          data: { code: before.code, votes: [before.votesPerShare, d.votesPerShare], liqPref: [before.liquidationPrefX.toString(), String(d.liquidationPrefX)] } },
        tx,
      );
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/settings/equity");
  return ok("Đã lưu lớp cổ phần.");
}

const roundFields = z.object({
  name: zText(120).min(2),
  status: z.enum(["PLANNED", "OPEN", "CLOSED"]),
  closeDate: zDate.optional(),
  currency: z.enum(["VND", "USD", "SGD", "JPY", "KRW", "EUR"]),
  preMoney: zMoney.optional(),
  pricePerShare: zMoney.optional(),
  targetAmount: zMoney.optional(),
  notes: zText(1000).optional(),
});

export async function saveRoundAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("equity.configure");
  if ("error" in u) return fail(u.error);
  const p = parseForm(roundFields.extend({ id: zId.optional(), code: zCode.optional() }), fd);
  if ("error" in p) return fail(p.error);
  const { id, code, ...d } = p.data;
  // Người không xem được tiền không được ghi đè định giá / giá cổ phần.
  const data = u.seeMoney ? d : { name: d.name, status: d.status, closeDate: d.closeDate, notes: d.notes };
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      if (id) {
        await tx.fundingRound.update({ where: { id }, data });
        await audit({ actorId: u.id, actorEmail: u.email, action: "round.update", entityType: "FundingRound", entityId: id, ip, data: { status: d.status } }, tx);
      } else {
        if (!code) throw new Error("code");
        const r = await tx.fundingRound.create({ data: { ...data, code } });
        await audit({ actorId: u.id, actorEmail: u.email, action: "round.create", entityType: "FundingRound", entityId: r.id, ip, data: { code } }, tx);
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "code") return fail("Thiếu mã vòng.");
    return dbError(e);
  }
  revalidatePath("/settings/equity");
  return ok(id ? "Đã lưu vòng gọi vốn." : "Đã tạo vòng gọi vốn.");
}

export async function setMajorThresholdAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("equity.configure");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ pct: z.coerce.number().min(0.1).max(100) }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { key: "major_shareholder_pct" },
      create: { key: "major_shareholder_pct", value: p.data.pct },
      update: { value: p.data.pct },
    });
    await audit({ actorId: u.id, actorEmail: u.email, action: "setting.major_threshold", ip, data: { pct: p.data.pct } }, tx);
  });
  revalidatePath("/settings/equity");
  return ok("Đã lưu ngưỡng cổ đông lớn.");
}
