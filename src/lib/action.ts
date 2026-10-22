import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";

export type PreviewRow = { line: number; label: string; detail: string; error?: string };
export type ActionResult = { ok: boolean; message: string; data?: Record<string, string>; rows?: PreviewRow[] };

export const ok = (message: string, data?: Record<string, string>): ActionResult => ({ ok: true, message, data });
export const fail = (message: string): ActionResult => ({ ok: false, message });

/** Đọc FormData theo schema zod. Ô trống → undefined để `.optional()` hoạt động. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  fd: FormData,
): { error: string } | { data: z.infer<T> } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$")) continue; // trường nội bộ của React
    if (typeof v === "string") raw[k] = v.trim() === "" ? undefined : v.trim();
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    return { error: `${first.path.join(".") || "Dữ liệu"}: ${first.message}` };
  }
  return { data: r.data as z.infer<T> };
}

// Kiểu dữ liệu dùng chung trong form
export const zId = z.string().regex(/^[a-z0-9]{20,40}$/i, "ID không hợp lệ");
export const zDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Ngày không hợp lệ");
export const zShares = z
  .string()
  .regex(/^\d{1,15}$/, "Số cổ phần phải là số nguyên dương")
  .transform((s) => BigInt(s))
  .refine((n) => n > 0n, "Số cổ phần phải > 0");
export const zMoney = z
  .string()
  .regex(/^\d{1,18}(\.\d{1,6})?$/, "Số tiền không hợp lệ")
  .transform((s) => new Prisma.Decimal(s));
export const zText = (max = 500) => z.string().max(max);

/** Lỗi Prisma/DB → thông báo an toàn (không lộ chi tiết nội bộ ra client). */
export function dbError(e: unknown): ActionResult {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return fail("Mã đã tồn tại, vui lòng dùng mã khác.");
  }
  const msg = e instanceof Error ? e.message : "";
  // Thông điệp từ trigger DB (RAISE EXCEPTION) là thông điệp nghiệp vụ, hiển thị được.
  const m = msg.match(/(?:ERROR|Error): ([^\n]+)/);
  if (m && /bất biến|Maker-checker|không được xoá|chỉ cho phép/i.test(m[1])) return fail(m[1]);
  console.error(e);
  return fail("Có lỗi khi lưu dữ liệu. Vui lòng thử lại.");
}
