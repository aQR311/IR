import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { hmacHex, safeEqualHex } from "./crypto";

// Nhật ký kiểm toán dạng chuỗi hash: hash_n = HMAC(pepper, hash_{n-1} | nội dung dòng n).
// Sửa / xoá / chèn một dòng ở giữa đều làm đứt chuỗi. Không có pepper thì không giả mạo được hash.

const GENESIS = "0".repeat(64);
const LOCK_KEY = 7_331_001; // advisory lock: ghi audit tuần tự để chuỗi không rẽ nhánh

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  data?: Record<string, unknown>;
};

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

function rowDigest(prevHash: string, at: Date, e: AuditEntry): string {
  const body = canonical({
    at: at.toISOString(),
    actorId: e.actorId ?? null,
    actorEmail: e.actorEmail ?? null,
    action: e.action,
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    ip: e.ip ?? null,
    data: e.data ?? null,
  });
  return hmacHex(`${prevHash}|${body}`, "audit");
}

async function append(tx: Tx, e: AuditEntry) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
  const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS;
  const at = new Date();
  const data = e.data ? (JSON.parse(canonical(e.data)) as Prisma.InputJsonValue) : Prisma.DbNull;
  await tx.auditLog.create({
    data: {
      at,
      actorId: e.actorId ?? null,
      actorEmail: e.actorEmail ?? null,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      ip: e.ip ?? null,
      data,
      prevHash,
      hash: rowDigest(prevHash, at, e),
    },
  });
}

/** Ghi audit. Truyền `tx` để audit nằm cùng transaction với thay đổi nghiệp vụ (cùng thành công / cùng huỷ). */
export async function audit(e: AuditEntry, tx?: Tx): Promise<void> {
  if (tx) return append(tx, e);
  await db.$transaction((t) => append(t, e));
}

/** Kiểm tra toàn bộ chuỗi. Trả về id dòng đầu tiên bị sai (nếu có). */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAt?: string }> {
  let prev = GENESIS;
  let checked = 0;
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await db.auditLog.findMany({
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const expected = rowDigest(prev, r.at, {
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        action: r.action,
        entityType: r.entityType ?? undefined,
        entityId: r.entityId ?? undefined,
        ip: r.ip,
        data: (r.data as Record<string, unknown> | null) ?? undefined,
      });
      if (r.prevHash !== prev || !safeEqualHex(r.hash, expected)) {
        return { ok: false, checked, brokenAt: r.id.toString() };
      }
      prev = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { ok: true, checked };
}
