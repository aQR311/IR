import "server-only";
import { randomInt } from "node:crypto";
import { db } from "../db";
import { hmacHex, safeEqualHex } from "../crypto";
import { otpEnabled } from "../env";
import { sendMail } from "../mail";
import { recordAttempt, tooManyFailures } from "./rate-limit";

// OTP email cho tài khoản bên ngoài (nhà đầu tư, kiểm toán). Không có mật khẩu.
const TTL_MIN = 10;
const MAX_TRIES = 5;
const MAX_SENDS_PER_15M = 3;

const digest = (email: string, code: string) => hmacHex(`${email}:${code}`, "otp");

/**
 * Luôn trả cùng một kết quả cho người gọi, dù email có tồn tại hay không — không cho dò danh sách tài khoản.
 */
export async function requestOtp(rawEmail: string, ip: string | null): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!otpEnabled()) return;
  if (await tooManyFailures(email, ip)) return;
  const since = new Date(Date.now() - 15 * 60_000);
  const recent = await db.otpCode.count({ where: { email, createdAt: { gte: since } } });
  if (recent >= MAX_SENDS_PER_15M) return;

  const user = await db.user.findUnique({ where: { email } });
  const eligible =
    user &&
    user.kind === "EXTERNAL" &&
    user.status === "ACTIVE" &&
    user.accessExpires &&
    user.accessExpires.getTime() > Date.now();
  if (!eligible) {
    await recordAttempt({ email, ip, method: "otp.request", ok: false, reason: "not_eligible" });
    return;
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.otpCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
  await db.otpCode.create({
    data: { email, codeHash: digest(email, code), expiresAt: new Date(Date.now() + TTL_MIN * 60_000), ip },
  });
  await sendMail(
    email,
    "Mã đăng nhập IR Appota",
    `Mã đăng nhập của bạn: ${code}\nMã có hiệu lực ${TTL_MIN} phút và chỉ dùng được một lần.\n` +
      `Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
  );
}

export async function verifyOtp(rawEmail: string, code: string, ip: string | null) {
  const email = rawEmail.trim().toLowerCase();
  if (!otpEnabled()) return null;
  const fail = async (reason: string) => {
    await recordAttempt({ email, ip, method: "otp", ok: false, reason });
    return null;
  };
  if (!/^\d{6}$/.test(code)) return fail("format");
  if (await tooManyFailures(email, ip)) return fail("rate_limited");

  const otp = await db.otpCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= MAX_TRIES) return fail("no_code");
  if (!safeEqualHex(otp.codeHash, digest(email, code))) {
    await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return fail("wrong_code");
  }
  // Đánh dấu đã dùng có điều kiện để 2 request song song không cùng dùng được 1 mã.
  const used = await db.otpCode.updateMany({
    where: { id: otp.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count !== 1) return fail("race");

  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.kind !== "EXTERNAL" || user.status !== "ACTIVE") return fail("not_eligible");
  if (!user.accessExpires || user.accessExpires.getTime() < Date.now()) return fail("expired");
  await recordAttempt({ email, ip, method: "otp", ok: true });
  return user;
}
