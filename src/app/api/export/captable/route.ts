import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { clientInfo } from "@/lib/request";
import { currentUser, recentlyAuthenticated } from "@/lib/session";
import { capTable } from "@/server/captable";

const CATEGORY: Record<string, string> = {
  FOUNDER: "Sáng lập", VC: "Quỹ VC", STRATEGIC: "Chiến lược", ANGEL: "Angel", EMPLOYEE: "Nhân viên", OTHER: "Khác",
};

// Xuất toàn bộ Cap Table là thao tác rủi ro cao: cần quyền riêng + đã xác thực trong 15 phút + ghi audit.
export async function GET() {
  const u = await currentUser();
  if (!u) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(u, "captable.export")) return new NextResponse("Forbidden", { status: 403 });
  if (!recentlyAuthenticated(u)) {
    return NextResponse.redirect(new URL("/login?error=reauth&next=/captable", env().APP_URL));
  }
  const t = await capTable();
  const { ip } = await clientInfo();
  await audit({ actorId: u.id, actorEmail: u.email, action: "captable.export", ip, data: { rows: t.rows.length } });

  const esc = (v: string) => (/[",\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${v.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : v);
  const header = ["Mã", "Tên", "Nhóm", "Nước ngoài", ...t.classes.map((c) => c.code), "Tổng CP", "Quyền ESOP", "% cơ sở", "% pha loãng", "Cổ đông lớn"];
  const lines = t.rows.map((r) =>
    [
      r.code, r.name, CATEGORY[r.category] ?? r.category, r.isForeign ? "Có" : "",
      ...t.classes.map((c) => (r.byClass[c.id] ?? 0n).toString()),
      r.issued.toString(), r.options.toString(), r.pctBasic.toFixed(4), r.pctFD.toFixed(4), r.major ? "Có" : "",
    ].map((v) => esc(String(v))).join(","),
  );
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="captable-${stamp}.csv"`,
      "cache-control": "no-store, private",
    },
  });
}
