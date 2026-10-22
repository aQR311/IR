"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decryptField, encryptField, maskTail } from "@/lib/crypto";
import { clientInfo } from "@/lib/request";
import { authorize, recentlyAuthenticated } from "@/lib/session";
import { dbError, fail, ok, parseForm, zDate, zId, zText, type ActionResult } from "@/lib/action";

const STAGES = [
  "LEAD", "CONTACTED", "NDA", "DUE_DILIGENCE", "TERM_SHEET", "COMMITTED",
  "SHAREHOLDER", "PARTIAL_EXIT", "EXITED", "DROPPED",
] as const;

const investorSchema = z.object({
  name: zText(200).min(2, "Tên quá ngắn"),
  type: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
  category: z.enum(["FOUNDER", "VC", "STRATEGIC", "ANGEL", "EMPLOYEE", "OTHER"]),
  stage: z.enum(STAGES).default("LEAD"),
  isForeign: z.literal("on").optional(),
  country: z.string().regex(/^[A-Z]{2}$/, "Mã quốc gia 2 chữ cái").default("VN"),
  email: z.email().max(200).optional(),
  phone: zText(40).optional(),
  address: zText(300).optional(),
  taxCode: zText(40).optional(),
  irOwnerId: zId.optional(),
  notes: zText(2000).optional(),
});

async function nextInvestorCode() {
  const last = await db.investor.findFirst({ orderBy: { code: "desc" }, select: { code: true } });
  const n = last ? Number(last.code.replace(/\D/g, "")) + 1 : 1;
  return `INV-${String(n).padStart(4, "0")}`;
}

export async function createInvestorAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("investors.edit");
  if ("error" in u) return fail(u.error);
  const p = parseForm(investorSchema, fd);
  if ("error" in p) return fail(p.error);
  const { isForeign, stage, ...rest } = p.data;
  const { ip } = await clientInfo();
  let id = "";
  try {
    id = await db.$transaction(async (tx) => {
      const inv = await tx.investor.create({
        data: { ...rest, stage, isForeign: isForeign === "on", code: await nextInvestorCode() },
      });
      await tx.stageChange.create({ data: { investorId: inv.id, to: stage, byId: u.id, note: "Tạo hồ sơ" } });
      await audit(
        { actorId: u.id, actorEmail: u.email, action: "investor.create", entityType: "Investor", entityId: inv.id, ip, data: { code: inv.code, name: inv.name, stage } },
        tx,
      );
      return inv.id;
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/investors");
  redirect(`/investors/${id}`);
}

export async function updateInvestorAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("investors.edit");
  if ("error" in u) return fail(u.error);
  const p = parseForm(investorSchema.omit({ stage: true }).extend({ id: zId }), fd);
  if ("error" in p) return fail(p.error);
  const { id, isForeign, ...rest } = p.data;
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const before = await tx.investor.findUniqueOrThrow({ where: { id } });
      const data = { ...rest, isForeign: isForeign === "on" };
      await tx.investor.update({ where: { id }, data });
      const changed = Object.keys(data).filter(
        (k) => String(before[k as keyof typeof before] ?? "") !== String(data[k as keyof typeof data] ?? ""),
      );
      await audit({ actorId: u.id, actorEmail: u.email, action: "investor.update", entityType: "Investor", entityId: id, ip, data: { changed } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath(`/investors/${id}`);
  return ok("Đã lưu hồ sơ.");
}

export async function changeStageAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("investors.edit");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId, stage: z.enum(STAGES), note: zText(500).optional() }), fd);
  if ("error" in p) return fail(p.error);
  const { id, stage, note } = p.data;
  // SHAREHOLDER / PARTIAL_EXIT / EXITED do sổ cái quyết định — không cho đặt tay để không lệch với Cap Table.
  if (stage === "SHAREHOLDER" || stage === "PARTIAL_EXIT" || stage === "EXITED") {
    return fail("Trạng thái cổ đông / exit được cập nhật tự động khi giao dịch cổ phần được ghi sổ.");
  }
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const inv = await tx.investor.findUniqueOrThrow({ where: { id } });
      if (inv.stage === "SHAREHOLDER" || inv.stage === "PARTIAL_EXIT") {
        throw new Error("holder");
      }
      await tx.investor.update({ where: { id }, data: { stage } });
      await tx.stageChange.create({ data: { investorId: id, from: inv.stage, to: stage, note, byId: u.id } });
      await audit({ actorId: u.id, actorEmail: u.email, action: "investor.stage", entityType: "Investor", entityId: id, ip, data: { from: inv.stage, to: stage } }, tx);
    });
  } catch (e) {
    if (e instanceof Error && e.message === "holder") {
      return fail("Nhà đầu tư đang nắm cổ phần — muốn exit hãy tạo giao dịch chuyển nhượng / mua lại.");
    }
    return dbError(e);
  }
  revalidatePath(`/investors/${id}`);
  return ok("Đã chuyển trạng thái.");
}

export async function addContactAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("investors.edit");
  if ("error" in u) return fail(u.error);
  const p = parseForm(
    z.object({ investorId: zId, name: zText(200).min(2), title: zText(100).optional(), email: z.email().optional(), phone: zText(40).optional() }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  const c = await db.investorContact.create({ data: p.data });
  await audit({ actorId: u.id, actorEmail: u.email, action: "investor.contact.add", entityType: "Investor", entityId: p.data.investorId, ip, data: { contactId: c.id } });
  revalidatePath(`/investors/${p.data.investorId}`);
  return ok("Đã thêm đầu mối.");
}

export async function addInteractionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("investors.edit");
  if ("error" in u) return fail(u.error);
  const p = parseForm(
    z.object({ investorId: zId, date: zDate, kind: z.enum(["MEETING", "CALL", "EMAIL", "NOTE"]), summary: zText(4000).min(3) }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  await db.interaction.create({ data: { ...p.data, userId: u.id } });
  revalidatePath(`/investors/${p.data.investorId}`);
  return ok("Đã ghi nhận tương tác.");
}

// ── KYC: số giấy tờ & tài khoản ngân hàng được mã hoá; xem bản rõ cần quyền + xác thực gần đây + ghi audit.

const aadFor = (investorId: string, field: "idNumber" | "bankAccount") => `investor:${investorId}:${field}`;

export async function updateKycAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("kyc.edit");
  if ("error" in u) return fail(u.error);
  const p = parseForm(
    z.object({
      investorId: zId,
      idNumber: zText(60).optional(),
      bankAccount: zText(120).optional(),
      kycStatus: z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"]),
    }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  const { investorId, idNumber, bankAccount, kycStatus } = p.data;
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.investor.update({
      where: { id: investorId },
      data: {
        kycStatus,
        ...(idNumber ? { idNumberEnc: encryptField(idNumber, aadFor(investorId, "idNumber")) } : {}),
        ...(bankAccount ? { bankAccountEnc: encryptField(bankAccount, aadFor(investorId, "bankAccount")) } : {}),
      },
    });
    await audit(
      { actorId: u.id, actorEmail: u.email, action: "kyc.update", entityType: "Investor", entityId: investorId, ip, data: { kycStatus, idNumber: Boolean(idNumber), bankAccount: Boolean(bankAccount) } },
      tx,
    );
  });
  revalidatePath(`/investors/${investorId}`);
  return ok("Đã cập nhật KYC (dữ liệu nhạy cảm đã được mã hoá).");
}

export async function revealKycAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("kyc.reveal");
  if ("error" in u) return fail(u.error);
  if (!recentlyAuthenticated(u)) {
    return fail("Cần xác thực lại (đăng nhập trong 15 phút gần nhất) để xem dữ liệu KYC.");
  }
  const p = parseForm(z.object({ investorId: zId, field: z.enum(["idNumber", "bankAccount"]) }), fd);
  if ("error" in p) return fail(p.error);
  const inv = await db.investor.findUnique({
    where: { id: p.data.investorId },
    select: { idNumberEnc: true, bankAccountEnc: true },
  });
  const enc = p.data.field === "idNumber" ? inv?.idNumberEnc : inv?.bankAccountEnc;
  if (!enc) return fail("Chưa có dữ liệu.");
  const { ip } = await clientInfo();
  // Ghi audit TRƯỚC khi trả dữ liệu: không có log thì không có dữ liệu.
  await audit({ actorId: u.id, actorEmail: u.email, action: "kyc.reveal", entityType: "Investor", entityId: p.data.investorId, ip, data: { field: p.data.field } });
  const value = decryptField(enc, aadFor(p.data.investorId, p.data.field));
  return ok("Đã giải mã — thao tác đã được ghi nhật ký.", { value, masked: maskTail(value) });
}
