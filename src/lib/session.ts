import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role, User, UserKind } from "@prisma/client";
import { db } from "./db";
import { isProd } from "./env";
import { randomToken, sha256Hex } from "./crypto";
import { audit } from "./audit";
import { clientInfo } from "./request";
import { can, canSeeMoney, isPortalRole, type Permission } from "./permissions";

// Phiên lưu ở DB (thu hồi được ngay), cookie chỉ chứa token ngẫu nhiên; DB chỉ lưu sha256(token).
const POLICY: Record<UserKind, { idleMin: number; absoluteHours: number }> = {
  INTERNAL: { idleMin: 60, absoluteHours: 10 },
  EXTERNAL: { idleMin: 30, absoluteHours: 4 },
};
const STEP_UP_MIN = 15; // thao tác nhạy cảm cần đã xác thực trong 15 phút gần nhất

const cookieName = () => (isProd() ? "__Host-irhub_sid" : "irhub_sid");

export type CurrentUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "kind" | "moneyAccess" | "investorId"
> & { sessionId: string; authAt: Date; seeMoney: boolean };

export async function createSession(user: Pick<User, "id" | "kind" | "email">, method: string) {
  // Đăng nhập lại (vd để xác thực bước cao) thì huỷ phiên cũ trên trình duyệt này.
  const old = (await cookies()).get(cookieName())?.value;
  if (old) await db.session.deleteMany({ where: { id: sha256Hex(old) } });
  const token = randomToken();
  const { ip, userAgent } = await clientInfo();
  const policy = POLICY[user.kind];
  const now = new Date();
  await db.session.create({
    data: {
      id: sha256Hex(token),
      userId: user.id,
      method,
      authAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + policy.absoluteHours * 3600_000),
      ip,
      userAgent,
    },
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  await audit({ actorId: user.id, actorEmail: user.email, action: "auth.login", ip, data: { method } });
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: policy.absoluteHours * 3600,
  });
}

async function loadSession(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token || token.length > 100) return null;
  const s = await db.session.findUnique({ where: { id: sha256Hex(token) }, include: { user: true } });
  if (!s) return null;
  const now = Date.now();
  const u = s.user;
  const idleMs = POLICY[u.kind].idleMin * 60_000;
  const expired =
    s.expiresAt.getTime() < now ||
    s.lastSeenAt.getTime() + idleMs < now ||
    u.status !== "ACTIVE" ||
    (u.kind === "EXTERNAL" && (!u.accessExpires || u.accessExpires.getTime() < now));
  if (expired) {
    await db.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    kind: u.kind,
    moneyAccess: u.moneyAccess,
    investorId: u.investorId,
    sessionId: s.id,
    authAt: s.authAt,
    seeMoney: canSeeMoney(u),
  };
}

/** Người dùng hiện tại (cache trong 1 request). */
export const currentUser = cache(loadSession);

/** Bắt buộc đăng nhập (+ quyền nếu có). Dùng ở đầu mọi trang, server action và route handler. */
export async function requireUser(perm?: Permission): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (perm && !can(u, perm)) redirect("/forbidden");
  return u;
}

/** Cho khu nội bộ: chặn tài khoản cổng nhà đầu tư. */
export async function requireInternal(perm?: Permission): Promise<CurrentUser> {
  const u = await requireUser(perm);
  if (isPortalRole(u.role)) redirect("/portal");
  return u;
}

/** Biến thể không redirect cho server action: trả lỗi để hiển thị thay vì nhảy trang. */
export async function authorize(perm: Permission): Promise<CurrentUser | { error: string }> {
  const u = await currentUser();
  if (!u) return { error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." };
  if (!can(u, perm)) return { error: "Bạn không có quyền thực hiện thao tác này." };
  return u;
}

export const recentlyAuthenticated = (u: CurrentUser) =>
  Date.now() - u.authAt.getTime() < STEP_UP_MIN * 60_000;

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (token) {
    const u = await currentUser();
    await db.session.deleteMany({ where: { id: sha256Hex(token) } });
    if (u) {
      const { ip } = await clientInfo();
      await audit({ actorId: u.id, actorEmail: u.email, action: "auth.logout", ip });
    }
  }
  jar.delete(cookieName());
}

export async function revokeAllSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export const homeFor = (role: Role) => (isPortalRole(role) ? "/portal" : "/dashboard");
