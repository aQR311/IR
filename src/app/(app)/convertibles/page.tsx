import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { CONVERTIBLE_LABEL, fmtDate, fmtMoney } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Empty, Field, Hidden, PageHeader, TableWrap } from "@/components/ui";
import { createConvertibleAction } from "@/server/actions/equity";

export const metadata: Metadata = { title: "SAFE / Chuyển đổi" };

export default async function Convertibles() {
  const u = await requireInternal("captable.view");
  const manage = can(u, "convertibles.manage") && u.seeMoney;
  const [list, investors] = await Promise.all([
    db.convertibleInstrument.findMany({ orderBy: { issueDate: "asc" }, include: { investor: { select: { id: true, name: true } } } }),
    manage ? db.investor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }) : [],
  ]);
  const money = (v: Parameters<typeof fmtMoney>[0], c: string) => (u.seeMoney ? fmtMoney(v, c) : <Hidden />);

  return (
    <>
      <PageHeader title="SAFE / Khoản đầu tư chuyển đổi" subtitle="Chưa tính vào Cap Table cho tới khi chuyển đổi thành cổ phần" />
      <TableWrap>
        <thead>
          <tr><th>Mã</th><th>Nhà đầu tư</th><th>Loại</th><th className="text-right">Gốc</th><th className="text-right">Valuation cap</th><th className="text-right">Chiết khấu</th><th>Ngày phát hành</th><th>Đáo hạn</th><th>Trạng thái</th></tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td className="font-medium">{c.code}</td>
              <td><Link href={`/investors/${c.investor.id}`} className="hover:underline">{c.investor.name}</Link></td>
              <td>{CONVERTIBLE_LABEL[c.kind]}</td>
              <td className="num whitespace-nowrap text-right">{money(c.principal, c.currency)}</td>
              <td className="num whitespace-nowrap text-right">{c.valuationCap ? money(c.valuationCap, c.currency) : "—"}</td>
              <td className="num text-right">{c.discountPct ? `${c.discountPct.toString()}%` : "—"}</td>
              <td className="whitespace-nowrap">{fmtDate(c.issueDate)}</td>
              <td className="whitespace-nowrap">{fmtDate(c.maturityDate)}</td>
              <td><Badge tone={c.status === "OUTSTANDING" ? "warn" : "neutral"}>{c.status === "OUTSTANDING" ? "Chưa chuyển đổi" : c.status === "CONVERTED" ? "Đã chuyển đổi" : "Đã huỷ"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {list.length === 0 && <Empty>Chưa có khoản đầu tư chuyển đổi.</Empty>}
      <p className="mt-2 text-xs text-muted">Mô phỏng số cổ phần khi chuyển đổi theo cap / chiết khấu thuộc phân hệ Mô phỏng vòng gọi vốn (Phase 3); công thức đã có trong lõi tính toán và đã được kiểm thử.</p>

      {manage && (
        <Card title="Ghi nhận khoản mới" className="mt-5 max-w-4xl">
          <ActionForm action={createConvertibleAction} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
            <Field label="Mã"><input name="code" required placeholder="SAFE-2026-01" className="field uppercase" /></Field>
            <Field label="Nhà đầu tư">
              <select name="investorId" className="field">{investors.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}</select>
            </Field>
            <Field label="Loại">
              <select name="kind" className="field">{Object.entries(CONVERTIBLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            <Field label="Số tiền gốc"><input name="principal" required className="field num" /></Field>
            <Field label="Tiền tệ"><select name="currency" defaultValue="USD" className="field">{["USD", "VND", "SGD", "JPY", "KRW", "EUR"].map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Valuation cap"><input name="valuationCap" className="field num" /></Field>
            <Field label="Chiết khấu (%)"><input name="discountPct" className="field num" /></Field>
            <Field label="Lãi suất (%/năm)"><input name="interestPct" className="field num" /></Field>
            <Field label="Ngày phát hành"><input type="date" name="issueDate" required className="field" /></Field>
            <Field label="Ngày đáo hạn"><input type="date" name="maturityDate" className="field" /></Field>
            <Field label="Số hợp đồng"><input name="docRef" className="field" /></Field>
            <div className="flex items-end"><Submit>Ghi nhận</Submit></div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
