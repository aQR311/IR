import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Empty, PageHeader, TableWrap } from "@/components/ui";
import { verifyAuditAction } from "@/server/actions/admin";

export const metadata: Metadata = { title: "Nhật ký kiểm toán" };

const tone = (a: string) =>
  /denied|integrity|reveal|export/.test(a) ? "bad" : /post|reverse|user\.|kyc/.test(a) ? "warn" : "neutral";

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireInternal("audit.view");
  const sp = await searchParams;
  const action = typeof sp.action === "string" ? sp.action.slice(0, 60) : "";
  const rows = await db.auditLog.findMany({
    where: action ? { action: { startsWith: action } } : {},
    orderBy: { id: "desc" },
    take: 300,
  });

  return (
    <>
      <PageHeader
        title="Nhật ký kiểm toán"
        subtitle="Chỉ ghi thêm (DB chặn sửa/xoá) và nối chuỗi HMAC — sửa một dòng bất kỳ sẽ làm đứt chuỗi"
        actions={
          <ActionForm action={verifyAuditAction}>
            <Submit variant="btn-ghost">Kiểm tra toàn vẹn chuỗi</Submit>
          </ActionForm>
        }
      />
      <form className="mb-3 flex gap-2" action="/audit">
        <input name="action" defaultValue={action} placeholder="Lọc theo hành động, vd kyc. / txn. / auth." className="field max-w-xs" aria-label="Lọc hành động" />
        <button className="btn-ghost">Lọc</button>
      </form>
      <TableWrap>
        <thead><tr><th>#</th><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>IP</th><th>Chi tiết</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id.toString()}>
              <td className="num text-muted">{r.id.toString()}</td>
              <td className="whitespace-nowrap">{fmtDateTime(r.at)}</td>
              <td className="whitespace-nowrap">{r.actorEmail ?? "hệ thống"}</td>
              <td><Badge tone={tone(r.action)}>{r.action}</Badge></td>
              <td className="whitespace-nowrap text-xs text-muted">{r.entityType ? `${r.entityType}:${r.entityId?.slice(-8)}` : "—"}</td>
              <td className="num text-xs text-muted">{r.ip ?? "—"}</td>
              <td className="max-w-md break-all font-mono text-[11px] text-muted">{r.data ? JSON.stringify(r.data) : ""}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {rows.length === 0 && <Empty>Chưa có nhật ký.</Empty>}
    </>
  );
}
