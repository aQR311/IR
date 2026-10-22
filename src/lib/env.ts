import "server-only";
import { z } from "zod";

const base64Key = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,16}:[A-Za-z0-9+/]{43}=$/, "Dạng <keyId>:<base64 32 byte>");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  DATA_KEY: base64Key,
  DATA_KEYS_PREVIOUS: z.string().default(""),
  AUTH_PEPPER: z.string().min(32),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_ALLOWED_DOMAIN: z.string().default("appota.com"),

  LARK_APP_ID: z.string().default(""),
  LARK_APP_SECRET: z.string().default(""),
  LARK_TENANT_KEY: z.string().default(""),
  LARK_ACCOUNTS_BASE: z.url().default("https://accounts.larksuite.com"),
  LARK_OPEN_BASE: z.url().default("https://open.larksuite.com"),

  MAIL_DRIVER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().default(""),
  MAIL_FROM: z.string().default("IR Appota <ir@appota.com>"),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(""),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_STORAGE_BUCKET: z.string().default("irhub-private"),

  ALLOW_DEV_LOGIN: z.string().default("false"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Đọc & kiểm tra biến môi trường một lần. Thiếu khoá bắt buộc → app dừng ngay, không chạy "nửa bảo mật". */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Cấu hình môi trường không hợp lệ: ${fields}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production") {
    if (e.MAIL_DRIVER === "console") throw new Error("MAIL_DRIVER=console bị cấm ở production");
    if (e.STORAGE_DRIVER === "local") throw new Error("STORAGE_DRIVER=local bị cấm ở production");
    if (!e.APP_URL.startsWith("https://")) throw new Error("APP_URL production phải là https");
  }
  cached = e;
  return e;
}

export const isProd = () => env().NODE_ENV === "production";

/** Đăng nhập nhanh chỉ cho máy dev: cần đủ 3 điều kiện, không thể bật nhầm trên Vercel. */
export function devLoginEnabled(): boolean {
  const e = env();
  return (
    e.NODE_ENV !== "production" &&
    e.ALLOW_DEV_LOGIN === "true" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(e.APP_URL)
  );
}

export const googleEnabled = () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
export const larkEnabled = () =>
  Boolean(env().LARK_APP_ID && env().LARK_APP_SECRET && env().LARK_TENANT_KEY);
