import "server-only";
import { headers } from "next/headers";

export type ClientInfo = { ip: string | null; userAgent: string | null };

/** IP thật của client. Trên Vercel, phần tử đầu của x-forwarded-for do edge của Vercel đặt. */
export async function clientInfo(): Promise<ClientInfo> {
  const h = await headers();
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = xff || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}
