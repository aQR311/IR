import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

// ── Mã hoá trường nhạy cảm & file: AES-256-GCM, khoá nằm ngoài DB (biến môi trường Vercel / KMS).
// Định dạng chuỗi: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url). keyId cho phép xoay khoá.

type Keyring = { currentId: string; keys: Map<string, Buffer> };
let ring: Keyring | null = null;

function parseKey(spec: string): [string, Buffer] {
  const [id, b64] = spec.trim().split(":");
  const key = Buffer.from(b64 ?? "", "base64");
  if (!id || key.length !== 32) throw new Error("Khoá mã hoá không hợp lệ");
  return [id, key];
}

function keyring(): Keyring {
  if (ring) return ring;
  const [currentId, current] = parseKey(env().DATA_KEY);
  const keys = new Map<string, Buffer>([[currentId, current]]);
  for (const spec of env().DATA_KEYS_PREVIOUS.split(",").filter(Boolean)) {
    const [id, key] = parseKey(spec);
    if (!keys.has(id)) keys.set(id, key);
  }
  ring = { currentId, keys };
  return ring;
}

const b64u = (b: Buffer) => b.toString("base64url");

export function encryptBytes(plain: Buffer, aad = ""): Buffer {
  const { currentId, keys } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(currentId)!, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header = Buffer.from(`v1.${currentId}.`);
  // header | iv(12) | tag(16) | ct — header độ dài thay đổi nên kèm 1 byte độ dài ở đầu.
  return Buffer.concat([Buffer.from([header.length]), header, iv, cipher.getAuthTag(), ct]);
}

export function decryptBytes(blob: Buffer, aad = ""): Buffer {
  const hlen = blob[0];
  const header = blob.subarray(1, 1 + hlen).toString();
  const [version, keyId] = header.split(".");
  if (version !== "v1") throw new Error("Phiên bản mã hoá không hỗ trợ");
  const key = keyring().keys.get(keyId);
  if (!key) throw new Error(`Không có khoá ${keyId} để giải mã`);
  const off = 1 + hlen;
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(off, off + 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(blob.subarray(off + 12, off + 28));
  return Buffer.concat([decipher.update(blob.subarray(off + 28)), decipher.final()]);
}

/** Mã hoá một chuỗi. `aad` gắn bản mã với ngữ cảnh (vd "investor:<id>:idNumber") để không bê sang dòng khác được. */
export function encryptField(plain: string, aad: string): string {
  return b64u(encryptBytes(Buffer.from(plain, "utf8"), aad));
}

export function decryptField(token: string, aad: string): string {
  return decryptBytes(Buffer.from(token, "base64url"), aad).toString("utf8");
}

export function maskTail(value: string, visible = 3): string {
  if (value.length <= visible) return "•".repeat(value.length);
  return "•".repeat(Math.min(8, value.length - visible)) + value.slice(-visible);
}

// ── Băm / HMAC / token

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export function hmacHex(data: string, purpose: string): string {
  return createHmac("sha256", env().AUTH_PEPPER).update(`${purpose}\n${data}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const randomToken = (bytes = 32) => b64u(randomBytes(bytes));

/** Ký một payload ngắn (vd trạng thái OAuth trong cookie). */
export function signPayload(obj: unknown, purpose: string): string {
  const body = b64u(Buffer.from(JSON.stringify(obj)));
  return `${body}.${hmacHex(body, purpose)}`;
}

export function verifyPayload<T>(token: string | undefined, purpose: string): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!safeEqualHex(sig, hmacHex(body, purpose))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
