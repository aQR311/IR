import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { fmtDate, fmtMoney, fmtShares, isoDate } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Empty, Field, Hidden, PageHeader, Stat, TableWrap } from "@/components/ui";
import { createGrantAction, createPoolAction, exerciseGrantAction, terminateGrantAction } from "@/server/actions/equity";
import { esopState } from "@/server/captable";

export const metadata: Metadata = { title: "ESOP" };

const FREQ: Record<string, string> = { MONTHLY: "tháng", QUARTERLY: "quý", YEARLY: "năm" };

export default async function Esop() {
  const u = await requireInternal("esop.view");
  const manage = can(u, "esop.manage");
  const [s, classes, holders] = await Promise.all([
    esopState(),
    db.shareClass.findMany({ where: { kind: "COMMON" }, select: { id: true, code: true } }),
    manage
      ? db.investor.findMany({ where: { category: { in: ["EMPLOYEE", "FOUNDER"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } })
      : [],
  ]);
  const vestedTotal = s.grants.reduce((a, g) => a + g.summary.vested, 0n);
  const exercisedTotal = s.grants.reduce((a, g) => a + g.summary.exercised, 0n);

  return (
    <>
      <PageHeader title="ESOP" subtitle="Bể quyền chọn, lịch vesting và thực hiện quyền của nhân sự" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Tổng bể ESOP" value={fmtShares(s.pool.poolSize)} />
        <Stat label="Đã cấp (ròng)" value={fmtShares(s.pool.granted - s.pool.forfeited)} hint={`Thu hồi: ${fmtShares(s.pool.forfeited)}`} />
        <Stat label="Còn trống" value={fmtShares(s.pool.available)} />
        <Stat label="Đã vest" value={fmtShares(vestedTotal)} />
        <Stat label="Đã thực hiện" value={fmtShares(exercisedTotal)} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th>Mã</th><th>Nhân sự</th><th>Ngày cấp</th><th className="text-right">Số quyền</th><th className="text-right">Giá thực hiện</th>
            <th>Lịch vest</th><th className="text-right">Đã vest</th><th className="text-right">Đã thực hiện</th><th className="text-right">Thu hồi</th><th>Trạng thái</th>{manage && <th />}
          </tr>
        </thead>
        <tbody>
          {s.grants.map(({ grant: g, summary: m }) => (
            <tr key={g.id}>
              <td className="whitespace-nowrap font-medium">{g.code}</td>
              <td><Link href={`/investors/${g.holder.id}`} className="hover:underline">{g.holder.name}</Link></td>
              <td className="whitespace-nowrap">{fmtDate(g.grantDate)}</td>
              <td className="num text-right">{fmtShares(g.quantity)}</td>
              <td className="num text-right">{u.seeMoney ? fmtMoney(g.exercisePrice) : <Hidden />}</td>
              <td className="whitespace-nowrap text-xs">Từ {fmtDate(g.vestingStart)}<br />cliff {g.cliffMonths}th · {g.vestingMonths}th · theo {FREQ[g.frequency]}</td>
              <td className="num text-right">{fmtShares(m.vested)}</td>
              <td className="num text-right">{fmtShares(m.exercised)}</td>
              <td className="num text-right">{m.forfeited ? fmtShares(m.forfeited) : "—"}</td>
              <td>
                <Badge tone={g.status === "ACTIVE" ? "ok" : "neutral"}>{g.status === "ACTIVE" ? "Hiệu lực" : g.status === "TERMINATED" ? `Nghỉ ${fmtDate(g.terminatedAt)}` : "Đã huỷ"}</Badge>
              </td>
              {manage && (
                <td className="whitespace-nowrap">
                  {m.exercisable > 0n && (
                    <details>
                      <summary className="cursor-pointer text-xs text-accent">Thực hiện quyền</summary>
                      <ActionForm action={exerciseGrantAction} className="mt-1 grid w-52 gap-1">
                        <input type="hidden" name="id" value={g.id} />
                        <input name="quantity" required defaultValue={m.exercisable.toString()} className="field num" aria-label="Số quyền" />
                        <input type="date" name="date" required defaultValue={isoDate(new Date())} className="field" aria-label="Ngày" />
                        <Submit variant="btn-ghost">Tạo yêu cầu</Submit>
                      </ActionForm>
                    </details>
                  )}
                  {g.status === "ACTIVE" && (
                    <details>
                      <summary className="cursor-pointer text-xs text-bad">Chấm dứt</summary>
                      <ActionForm action={terminateGrantAction} confirm="Chấm dứt quyền ESOP? Phần chưa vest sẽ thu hồi về bể." className="mt-1 grid w-52 gap-1">
                        <input type="hidden" name="id" value={g.id} />
                        <input type="date" name="terminatedAt" required defaultValue={isoDate(new Date())} className="field" aria-label="Ngày nghỉ" />
                        <Submit variant="btn-danger">Xác nhận</Submit>
                      </ActionForm>
                    </details>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {s.grants.length === 0 && <Empty>Chưa cấp quyền ESOP nào.</Empty>}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card title="Các đợt bể ESOP">
          <ul className="space-y-2 text-sm">
            {s.pools.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>{p.name}<span className="block text-xs text-muted">{fmtDate(p.approvedAt)}{p.resolution ? ` · ${p.resolution}` : ""}</span></span>
                <span className="num">{fmtShares(p.size)}</span>
              </li>
            ))}
          </ul>
          {manage && (
            <ActionForm action={createPoolAction} resetOnSuccess className="mt-4 grid gap-2 border-t border-line pt-3">
              <input name="name" required placeholder="Tên đợt (vd Mở rộng 2026)" className="field" />
              <select name="shareClassId" className="field" aria-label="Lớp cổ phần">{classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
              <input name="size" required placeholder="Số cổ phần" className="field num" />
              <input type="date" name="approvedAt" required className="field" aria-label="Ngày duyệt" />
              <input name="resolution" placeholder="Số nghị quyết HĐQT/ĐHĐCĐ" className="field" />
              <Submit variant="btn-ghost">Thêm đợt bể</Submit>
            </ActionForm>
          )}
        </Card>

        {manage && (
          <Card title="Cấp quyền ESOP" className="lg:col-span-2">
            <ActionForm action={createGrantAction} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
              <Field label="Mã quyền"><input name="code" required placeholder="ESOP-2026-001" className="field uppercase" /></Field>
              <Field label="Nhân sự">
                <select name="holderId" className="field">{holders.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}</select>
              </Field>
              <Field label="Thuộc bể">
                <select name="poolId" className="field">{s.pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </Field>
              <Field label="Số quyền"><input name="quantity" required className="field num" /></Field>
              {u.seeMoney && <Field label="Giá thực hiện (VND/CP)"><input name="exercisePrice" className="field num" /></Field>}
              <Field label="Ngày cấp"><input type="date" name="grantDate" required className="field" /></Field>
              <Field label="Bắt đầu vest"><input type="date" name="vestingStart" required className="field" /></Field>
              <Field label="Cliff (tháng)"><input name="cliffMonths" type="number" defaultValue={12} min={0} className="field num" /></Field>
              <Field label="Tổng thời gian (tháng)"><input name="vestingMonths" type="number" defaultValue={48} min={1} className="field num" /></Field>
              <Field label="Chu kỳ">
                <select name="frequency" className="field"><option value="MONTHLY">Hằng tháng</option><option value="QUARTERLY">Hằng quý</option><option value="YEARLY">Hằng năm</option></select>
              </Field>
              <Field label="Số thoả thuận / QĐ"><input name="docRef" className="field" /></Field>
              <div className="flex items-end"><Submit>Cấp quyền</Submit></div>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">Thực hiện quyền tạo giao dịch phát hành nháp; Kế toán xác nhận tiền về và ghi sổ (maker–checker) thì cổ phần mới vào Cap Table.</p>
          </Card>
        )}
      </div>
    </>
  );
}
