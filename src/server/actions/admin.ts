"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, verifyAuditChain } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { clientInfo } from "@/lib/request";
import { authorize, revokeAllSessions } from "@/lib/session";
import { can } from "@/lib/permissions";
import { checkFile, putObject } from "@/lib/storage";
import { dbError, fail, ok, parseForm, zDate, zId, zText, type ActionResult } from "@/lib/action";

const ROLES = ["SYS_ADMIN", "EXEC", "IR_LEAD", "IR_STAFF", "LEGAL", "FINANCE", "HR_ESOP", "AUDITOR", "INVESTOR", "PROSPECT"] as const;
const EXTERNAL_ROLES = new Set(["AUDITOR", "INVESTOR", "PROSPECT"]);

const userSchema = z.object({
  email: z.email().max(200).transform((s) => s.toLowerCase()),
  name: zText(200).min(2),
  role: z.enum(ROLES),
  moneyAccess: z.enum(["ROLE_DEFAULT", "NONE", "FULL"]).default("ROLE_DEFAULT"),
  investorId: zId.optional(),
  accessExpires: zDate.optional(),
});

/**
 * Tài khoản nội bộ phải dùng email domain công ty (đăng nhập Lark/Google).
 * Tài khoản ngoài bắt buộc có ngày hết hạn (tối đa 1 năm) và dùng OTP email.
 */
function validateUser(d: z.infer<typeof userSchema>): string | null {
  const domain = env().GOOGLE_ALLOWED_DOMAIN.toLowerCase();
  const external = EXTERNAL_ROLES.has(d.role) && !d.email.endsWith(`@${domain}`);
  if (!external && !d.email.endsWith(`@${domain}`)) return `Nhân sự nội bộ phải dùng email @${domain}.`;
  if (external) {
    if (!d.accessExpires) return "Tài khoản bên ngoài bắt buộc có ngày hết hạn truy cập.";
    if (d.accessExpires.getTime() > Date.now() + 366 * 86400_000) return "Hạn truy cập tối đa 1 năm.";
  }
  if ((d.role === "INVESTOR" || d.role === "PROSPECT") && !d.investorId) {
    return "Tài khoản nhà đầu tư phải gắn với một hồ sơ nhà đầu tư.";
  }
  return null;
}

export async function createUserAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("users.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(userSchema, fd);
  if ("error" in p) return fail(p.error);
  const err = validateUser(p.data);
  if (err) return fail(err);
  const domain = env().GOOGLE_ALLOWED_DOMAIN.toLowerCase();
  const kind = p.data.email.endsWith(`@${domain}`) ? "INTERNAL" : "EXTERNAL";
  const { ip } = await clientInfo();
  try {
    await db.$transaction(async (tx) => {
      const nu = await tx.user.create({ data: { ...p.data, kind, createdById: u.id } });
      await audit({ actorId: u.id, actorEmail: u.email, action: "user.create", entityType: "User", entityId: nu.id, ip, data: { email: nu.email, role: nu.role, kind } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/admin/users");
  return ok(kind === "INTERNAL" ? "Đã tạo — nhân sự đăng nhập bằng Lark hoặc Google Workspace." : "Đã tạo — người dùng đăng nhập bằng mã OTP gửi qua email.");
}

export async function updateUserAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("users.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(
    z.object({
      id: zId,
      role: z.enum(ROLES),
      status: z.enum(["ACTIVE", "SUSPENDED"]),
      moneyAccess: z.enum(["ROLE_DEFAULT", "NONE", "FULL"]),
      accessExpires: zDate.optional(),
    }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  if (p.data.id === u.id) return fail("Không tự sửa quyền / trạng thái của chính mình.");
  const target = await db.user.findUnique({ where: { id: p.data.id } });
  if (!target) return fail("Không tìm thấy tài khoản.");
  const err = validateUser({ ...target, ...p.data, investorId: target.investorId ?? undefined, accessExpires: p.data.accessExpires });
  if (err) return fail(err);
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: p.data });
    await audit({ actorId: u.id, actorEmail: u.email, action: "user.update", entityType: "User", entityId: target.id, ip, data: { from: { role: target.role, status: target.status, moneyAccess: target.moneyAccess }, to: { role: p.data.role, status: p.data.status, moneyAccess: p.data.moneyAccess } } }, tx);
  });
  // Đổi quyền / khoá tài khoản → huỷ mọi phiên để áp dụng ngay.
  if (target.role !== p.data.role || p.data.status !== "ACTIVE" || target.moneyAccess !== p.data.moneyAccess) {
    await revokeAllSessions(target.id);
  }
  revalidatePath("/admin/users");
  return ok("Đã cập nhật tài khoản.");
}

export async function revokeSessionsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("users.manage");
  if ("error" in u) return fail(u.error);
  const p = parseForm(z.object({ id: zId }), fd);
  if ("error" in p) return fail(p.error);
  const { ip } = await clientInfo();
  await revokeAllSessions(p.data.id);
  await audit({ actorId: u.id, actorEmail: u.email, action: "user.revoke_sessions", entityType: "User", entityId: p.data.id, ip });
  revalidatePath("/admin/users");
  return ok("Đã đăng xuất tài khoản khỏi mọi thiết bị.");
}

export async function verifyAuditAction(): Promise<ActionResult> {
  const u = await authorize("audit.view");
  if ("error" in u) return fail(u.error);
  const r = await verifyAuditChain();
  const { ip } = await clientInfo();
  await audit({ actorId: u.id, actorEmail: u.email, action: "audit.verify", ip, data: { ok: r.ok, checked: r.checked } });
  return r.ok
    ? ok(`Chuỗi nhật ký toàn vẹn: ${r.checked.toLocaleString("vi-VN")} dòng hợp lệ.`)
    : fail(`PHÁT HIỆN SAI LỆCH tại dòng #${r.brokenAt} — nhật ký có thể đã bị can thiệp.`);
}

// ── Tài liệu

export async function uploadDocumentAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const u = await authorize("documents.upload");
  if ("error" in u) return fail(u.error);
  const file = fd.get("file");
  if (!(file instanceof File)) return fail("Chưa chọn file.");
  const p = parseForm(
    z.object({
      title: zText(200).min(2),
      category: z.enum(["CONTRACT", "CERTIFICATE", "KYC", "RESOLUTION", "FINANCIAL", "OTHER"]),
      confidentiality: z.enum(["INTERNAL", "CONFIDENTIAL", "STRICT"]),
      investorId: zId.optional(),
    }),
    fd,
  );
  if ("error" in p) return fail(p.error);
  if (p.data.confidentiality === "STRICT" && !can(u, "documents.strict")) {
    return fail("Bạn không được tải lên tài liệu mức Tối mật.");
  }
  if (p.data.confidentiality === "CONFIDENTIAL" && !can(u, "documents.confidential")) {
    return fail("Bạn không được tải lên tài liệu mức Mật.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const bad = checkFile(file.type, bytes);
  if (bad) return fail(bad);
  const key = `docs/${new Date().getUTCFullYear()}/${randomUUID()}`;
  const { ip } = await clientInfo();
  try {
    await putObject(key, bytes);
    await db.$transaction(async (tx) => {
      const d = await tx.document.create({
        data: {
          ...p.data,
          storageKey: key,
          fileName: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 150),
          mime: file.type,
          size: bytes.length,
          sha256: sha256Hex(bytes),
          uploadedById: u.id,
        },
      });
      await audit({ actorId: u.id, actorEmail: u.email, action: "document.upload", entityType: "Document", entityId: d.id, ip, data: { title: d.title, sha256: d.sha256, confidentiality: d.confidentiality } }, tx);
    });
  } catch (e) {
    return dbError(e);
  }
  revalidatePath("/documents");
  return ok("Đã tải lên (file được mã hoá trước khi lưu).");
}
