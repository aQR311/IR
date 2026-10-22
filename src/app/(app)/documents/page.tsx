import type { Metadata } from "next";
import Link from "next/link";
import type { Confidentiality } from "@prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { CONF_LABEL, DOC_CATEGORY_LABEL, fmtDateTime } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Empty, Field, PageHeader, TableWrap } from "@/components/ui";
import { uploadDocumentAction } from "@/server/actions/admin";

export const metadata: Metadata = { title: "Tài liệu" };

export default async function Documents({ searchParams }: PageProps<"/documents">) {
  const u = await requireInternal("documents.view");
  const sp = await searchParams;
  const presetInvestor = typeof sp.investorId === "string" ? sp.investorId : "";

  // Chỉ liệt kê tài liệu ở mức mật người xem được — không lộ cả tiêu đề tài liệu ngoài quyền.
  const levels: Confidentiality[] = ["INTERNAL"];
  if (can(u, "documents.confidential")) levels.push("CONFIDENTIAL");
  if (can(u, "documents.strict")) levels.push("STRICT");

  const [docs, investors] = await Promise.all([
    db.document.findMany({
      where: { deletedAt: null, confidentiality: { in: levels } },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { investor: { select: { id: true, name: true } } },
    }),
    can(u, "documents.upload") ? db.investor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }) : [],
  ]);
  const uploaders = Object.fromEntries(
    (await db.user.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.uploadedById))] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]),
  );

  return (
    <>
      <PageHeader title="Kho tài liệu" subtitle="File được mã hoá AES-256-GCM trước khi lưu; mọi lượt tải đều ghi nhật ký" />

      {can(u, "documents.upload") && (
        <Card title="Tải lên" className="mb-5">
          <ActionForm action={uploadDocumentAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Tiêu đề" className="lg:col-span-2"><input name="title" required className="field" /></Field>
            <Field label="Loại">
              <select name="category" className="field">{Object.entries(DOC_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            <Field label="Mức mật">
              <select name="confidentiality" defaultValue="CONFIDENTIAL" className="field">
                {levels.map((l) => <option key={l} value={l}>{CONF_LABEL[l]}</option>)}
              </select>
            </Field>
            <Field label="Gắn với nhà đầu tư">
              <select name="investorId" defaultValue={presetInvestor} className="field">
                <option value="">—</option>
                {investors.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </select>
            </Field>
            <Field label="File (PDF, PNG, JPEG, DOCX, XLSX · tối đa 4MB)" className="lg:col-span-4">
              <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" className="field" />
            </Field>
            <div className="flex items-end"><Submit>Tải lên</Submit></div>
          </ActionForm>
        </Card>
      )}

      <TableWrap>
        <thead><tr><th>Tiêu đề</th><th>Loại</th><th>Mức mật</th><th>Nhà đầu tư</th><th>Người tải</th><th>Thời gian</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td><a href={`/api/files/${d.id}`} className="font-medium hover:underline">{d.title}</a><div className="text-xs text-muted">{d.fileName} · {(d.size / 1024).toFixed(0)} KB</div></td>
              <td>{DOC_CATEGORY_LABEL[d.category] ?? d.category}</td>
              <td><Badge tone={d.confidentiality === "STRICT" ? "bad" : d.confidentiality === "CONFIDENTIAL" ? "warn" : "neutral"}>{CONF_LABEL[d.confidentiality]}</Badge></td>
              <td>{d.investor ? <Link href={`/investors/${d.investor.id}`} className="hover:underline">{d.investor.name}</Link> : "—"}</td>
              <td className="text-muted">{uploaders[d.uploadedById] ?? "?"}</td>
              <td className="whitespace-nowrap text-muted">{fmtDateTime(d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {docs.length === 0 && <Empty>Chưa có tài liệu.</Empty>}
    </>
  );
}
