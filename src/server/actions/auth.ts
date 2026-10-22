"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { devLoginEnabled } from "@/lib/env";
import { clientInfo } from "@/lib/request";
import { createSession, destroySession, homeFor } from "@/lib/session";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { recordAttempt } from "@/lib/auth/rate-limit";
import { fail, ok, parseForm, type ActionResult } from "@/lib/action";

const emailSchema = z.object({ email: z.email().max(200) });

export async function requestOtpAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const p = parseForm(emailSchema, fd);
  if ("error" in p) return fail("Email không hợp lệ");
  const { ip } = await clientInfo();
  await requestOtp(p.data.email, ip);
  // Cùng một thông điệp cho mọi trường hợp.
  return ok("Nếu email đã được cấp quyền, mã đăng nhập sẽ được gửi trong ít phút.", {
    email: p.data.email.toLowerCase(),
  });
}

export async function verifyOtpAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const p = parseForm(z.object({ email: z.email().max(200), code: z.string().max(6) }), fd);
  if ("error" in p) return fail("Mã hoặc email không hợp lệ");
  const { ip } = await clientInfo();
  const user = await verifyOtp(p.data.email, p.data.code, ip);
  if (!user) return { ...fail("Mã không đúng hoặc đã hết hạn."), data: { email: p.data.email } };
  await createSession(user, "otp");
  redirect(homeFor(user.role));
}

export async function devLoginAction(fd: FormData) {
  if (!devLoginEnabled()) throw new Error("Đăng nhập dev bị tắt");
  const email = String(fd.get("email") ?? "").toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") throw new Error("Không có tài khoản");
  const { ip } = await clientInfo();
  await recordAttempt({ email, ip, method: "dev", ok: true });
  await createSession(user, "dev");
  redirect(homeFor(user.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
