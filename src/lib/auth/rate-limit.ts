import "server-only";
import { db } from "../db";

const WINDOW_MIN = 15;

/** Chống dò: tối đa 5 lần sai / email và 20 lần sai / IP trong 15 phút. */
export async function tooManyFailures(email: string | null, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const [byEmail, byIp] = await Promise.all([
    email ? db.loginAttempt.count({ where: { email, ok: false, createdAt: { gte: since } } }) : 0,
    ip ? db.loginAttempt.count({ where: { ip, ok: false, createdAt: { gte: since } } }) : 0,
  ]);
  return byEmail >= 5 || byIp >= 20;
}

export async function recordAttempt(a: {
  email: string | null;
  ip: string | null;
  method: string;
  ok: boolean;
  reason?: string;
}) {
  await db.loginAttempt.create({ data: a });
}
