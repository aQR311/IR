import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import { can } from "@/lib/permissions";
import { clientInfo } from "@/lib/request";
import { currentUser } from "@/lib/session";
import { getObject } from "@/lib/storage";

const PORTAL_CATEGORIES = new Set(["CERTIFICATE", "CONTRACT", "RESOLUTION"]);

// File chỉ phục vụ qua route này: kiểm tra phiên + quyền theo mức mật → ghi audit → giải mã → trả về.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const u = await currentUser();
  if (!u) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) return new NextResponse("Not found", { status: 404 });

  // Nhà đầu tư chỉ tải được chứng từ của chính mình thuộc các loại được hiển thị trên cổng (không gồm hồ sơ KYC nội bộ).
  const portalOwner =
    (u.role === "INVESTOR" || u.role === "PROSPECT") &&
    doc.investorId !== null &&
    doc.investorId === u.investorId &&
    PORTAL_CATEGORIES.has(doc.category);
  const allowed =
    portalOwner ||
    (can(u, "documents.view") &&
      (doc.confidentiality === "INTERNAL" ||
        (doc.confidentiality === "CONFIDENTIAL" && can(u, "documents.confidential")) ||
        (doc.confidentiality === "STRICT" && can(u, "documents.strict"))));
  const { ip } = await clientInfo();
  if (!allowed) {
    await audit({ actorId: u.id, actorEmail: u.email, action: "document.denied", entityType: "Document", entityId: doc.id, ip });
    return new NextResponse("Forbidden", { status: 403 });
  }

  await audit({ actorId: u.id, actorEmail: u.email, action: "document.download", entityType: "Document", entityId: doc.id, ip, data: { title: doc.title } });
  const bytes = await getObject(doc.storageKey);
  if (sha256Hex(bytes) !== doc.sha256) {
    await audit({ actorId: u.id, actorEmail: u.email, action: "document.integrity_fail", entityType: "Document", entityId: doc.id, ip });
    return new NextResponse("File integrity check failed", { status: 500 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": doc.mime,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
}
