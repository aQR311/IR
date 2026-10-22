// Tạo tài khoản quản trị ĐẦU TIÊN cho một DB mới (bản thật không có đăng nhập nhanh).
//
//   $env:DOTENV_CONFIG_PATH=".env.production.local"
//   npm run bootstrap -- --email it@appota.com --name "Nguyễn A" --role SYS_ADMIN
//   npm run bootstrap -- --email cfo@appota.com --name "Trần B" --role EXEC
//
// Chỉ tạo được SYS_ADMIN / EXEC, và chỉ khi vai trò đó CHƯA có ai đang hoạt động —
// sau lần đầu, mọi tài khoản phải tạo trong màn hình Tài khoản (có audit). Không thành cửa hậu.
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { audit } from "../src/lib/audit";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" } },
});

async function main() {
  const domain = (process.env.GOOGLE_ALLOWED_DOMAIN ?? "appota.com").toLowerCase();
  const email = values.email?.trim().toLowerCase() ?? "";
  const name = values.name?.trim() ?? "";
  const role = values.role;
  if (!email.endsWith(`@${domain}`)) throw new Error(`--email phải là email @${domain}`);
  if (name.length < 2) throw new Error("Thiếu --name");
  if (role !== "SYS_ADMIN" && role !== "EXEC") throw new Error("--role chỉ nhận SYS_ADMIN hoặc EXEC");

  const db = new PrismaClient();
  try {
    if (await db.user.findUnique({ where: { email } })) throw new Error(`${email} đã tồn tại`);
    const existing = await db.user.count({ where: { role, status: "ACTIVE" } });
    if (existing > 0) {
      throw new Error(`Đã có ${role} đang hoạt động — hãy tạo tài khoản trong màn hình Tài khoản.`);
    }
    const u = await db.user.create({ data: { email, name, role, kind: "INTERNAL" } });
    await audit({ action: "user.bootstrap", entityType: "User", entityId: u.id, data: { email, role } });
    const host = (process.env.DATABASE_URL ?? "").replace(/^.*@([^:/]+).*$/, "$1");
    console.log(`✔ Đã tạo ${role}: ${email} (DB: ${host}). Đăng nhập bằng Google / Lark với email này.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✖ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
