// Postgres cục bộ cho phát triển (không cần Docker). Chạy: npm run db:local
// Dữ liệu nằm NGOÀI thư mục OneDrive để tránh đồng bộ / khoá file.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share");
const dataDir = process.env.LOCAL_PG_DIR ?? path.join(base, "appota-ir-hub", "pg");
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const password = process.env.LOCAL_PG_PASSWORD ?? "irhub_local";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password,
  port,
  persistent: true,
  // Giống Supabase: UTF-8. Mặc định trên Windows là WIN1252 → lỗi với tiếng Việt.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) {
  console.log(`[db] Khởi tạo cluster mới tại ${dataDir}`);
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase("irhub");

console.log(`[db] Postgres chạy tại 127.0.0.1:${port} (db: irhub). Ctrl+C để dừng.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
