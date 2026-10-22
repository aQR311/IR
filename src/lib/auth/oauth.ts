import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { isProd } from "../env";
import { randomToken, signPayload, verifyPayload } from "../crypto";
import { db } from "../db";
import { recordAttempt } from "./rate-limit";
import type { LoginError } from "./errors";

// Trạng thái OAuth (state + PKCE verifier + nonce) giữ trong cookie httpOnly đã ký, sống 10 phút.
export type OAuthState = {
  provider: "google" | "lark";
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  exp: number;
};

const COOKIE = () => (isProd() ? "__Host-irhub_oauth" : "irhub_oauth");

export async function beginOAuth(provider: OAuthState["provider"], next: string) {
  const st: OAuthState = {
    provider,
    state: randomToken(24),
    verifier: randomToken(48),
    nonce: randomToken(24),
    next: safeNext(next),
    exp: Date.now() + 10 * 60_000,
  };
  (await cookies()).set(COOKIE(), signPayload(st, "oauth"), {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  const challenge = createHash("sha256").update(st.verifier).digest("base64url");
  return { ...st, challenge };
}

/** Đọc và XOÁ cookie trạng thái (dùng một lần). Sai state → null. */
export async function consumeOAuth(provider: OAuthState["provider"], state: string | null) {
  const jar = await cookies();
  const st = verifyPayload<OAuthState>(jar.get(COOKIE())?.value, "oauth");
  jar.delete(COOKIE());
  if (!st || st.provider !== provider || !state || st.state !== state || st.exp < Date.now()) {
    return null;
  }
  return st;
}

/** Chỉ cho phép quay về đường dẫn nội bộ — chặn open redirect. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "";
  return next;
}

/**
 * Tìm tài khoản nội bộ đã được cấp trước. Đăng nhập SSO thành công KHÔNG tự tạo tài khoản:
 * Admin phải tạo trước và gán vai trò. Lần đầu sẽ gắn định danh nhà cung cấp (sub/open_id) vào tài khoản;
 * các lần sau định danh phải khớp — chống chiếm tài khoản khi email bị cấp lại cho người khác.
 */
export async function matchInternalUser(opts: {
  provider: "google" | "lark";
  subject: string;
  email: string;
  ip: string | null;
}) {
  const email = opts.email.toLowerCase();
  const field = opts.provider === "google" ? "googleSub" : "larkOpenId";
  const user = await db.user.findUnique({ where: { email } });
  const fail = async (reason: LoginError) => {
    await recordAttempt({ email, ip: opts.ip, method: opts.provider, ok: false, reason });
    return { error: reason } as const;
  };
  if (!user) return fail("not_provisioned");
  if (user.kind !== "INTERNAL") return fail("wrong_kind");
  if (user.status !== "ACTIVE") return fail("suspended");
  const bound = user[field];
  if (bound && bound !== opts.subject) return fail("identity_mismatch");
  if (!bound) {
    const taken = await db.user.findFirst({ where: { [field]: opts.subject } });
    if (taken) return fail("identity_mismatch");
    await db.user.update({ where: { id: user.id }, data: { [field]: opts.subject } });
  }
  await recordAttempt({ email, ip: opts.ip, method: opts.provider, ok: true });
  return { user } as const;
}
