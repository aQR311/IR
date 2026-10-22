import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { decryptBytes, encryptBytes } from "./crypto";

// File luôn được mã hoá ở tầng app TRƯỚC khi rời server, nên kể cả bucket bị lộ cũng chỉ thấy bản mã.
// Dev: thư mục ngoài OneDrive. Prod: Supabase Storage bucket private, chỉ server (service role) truy cập.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel Functions giới hạn body ~4.5MB

const ALLOWED: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString() === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b.subarray(0, 4).equals(Buffer.from("PK\x03\x04", "binary")),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => b.subarray(0, 4).equals(Buffer.from("PK\x03\x04", "binary")),
};

/** Kiểm tra cả MIME khai báo lẫn chữ ký nhị phân thật của file. */
export function checkFile(mime: string, bytes: Buffer): string | null {
  if (bytes.length === 0) return "File rỗng";
  if (bytes.length > MAX_UPLOAD_BYTES) return "File vượt quá 4MB";
  const check = ALLOWED[mime];
  if (!check) return "Chỉ nhận PDF, PNG, JPEG, DOCX, XLSX";
  if (!check(bytes)) return "Nội dung file không khớp định dạng khai báo";
  return null;
}

function localDir() {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share");
  return env().LOCAL_STORAGE_DIR || path.join(base, "appota-ir-hub", "files");
}

function supabase() {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(e.SUPABASE_STORAGE_BUCKET);
}

const safeKey = (key: string) => {
  if (!/^[a-z0-9][a-z0-9/_-]{8,120}$/.test(key) || key.includes("..")) throw new Error("storage key lỗi");
  return key;
};

export async function putObject(key: string, plain: Buffer) {
  const blob = encryptBytes(plain, `file:${safeKey(key)}`);
  if (env().STORAGE_DRIVER === "local") {
    const file = path.join(localDir(), key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, blob, { flag: "wx" }); // không bao giờ ghi đè
    return;
  }
  const { error } = await supabase().upload(key, blob, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Upload lỗi: ${error.message}`);
}

export async function getObject(key: string): Promise<Buffer> {
  let blob: Buffer;
  if (env().STORAGE_DRIVER === "local") {
    blob = await readFile(path.join(localDir(), safeKey(key)));
  } else {
    const { data, error } = await supabase().download(safeKey(key));
    if (error || !data) throw new Error("Không tải được file");
    blob = Buffer.from(await data.arrayBuffer());
  }
  return decryptBytes(blob, `file:${key}`);
}
