import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { pct } from "@/lib/cap-math";
import { CATEGORY_LABEL, fmtPct, fmtShares } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap } from "@/components/ui";
import { capTable } from "@/server/captable";
import { InlineBar } from "@/components/charts/charts";
import { CATEGORY_SERIES } from "@/server/analytics";

const seriesFor = (cat: string) => CATEGORY_SERIES.find((s) => s.key === cat)?.color ?? "var(--series-muted)";

export const metadata: Metadata = { title: "Cap Table" };

export default async function CapTablePage({ searchParams }: PageProps<"/captable">) {
  const u = await requireInternal("captable.view");
  const sp = await searchParams;
  const view = sp.view === "class" ? "class" : "holder";
  const t = await capTable();

  const maxPct = Math.max(...t.rows.map((r) => r.pctBasic), 1);
  const byCategory = new Map<string, { issued: bigint; options: bigint; n: number }>();
  for (const r of t.rows) {
    const c = byCategory.get(r.category) ?? { issued: 0n, options: 0n, n: 0 };
    byCategory.set(r.category, { issued: c.issued + r.issued, options: c.options + r.options, n: c.n + 1 });
  }

  return (
    <>
      <PageHeader
        title="Cap Table"
        subtitle="Tính trực tiếp từ sổ cái — chỉ các giao dịch đã ghi sổ"
        actions={
          <>
            <Link href="/captable" className={view === "holder" ? "btn" : "btn-ghost"}>Theo cổ đông</Link>
            <Link href="/captable?view=class" className={view === "class" ? "btn" : "btn-ghost"}>Theo lớp / nhóm</Link>
            {can(u, "captable.export") && (
              <a href="/api/export/captable" className="btn-ghost" title="Cần đã đăng nhập trong 15 phút gần nhất; thao tác được ghi nhật ký">Xuất CSV</a>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Đã phát hành (cơ sở)" value={fmtShares(t.issued)} />
        <Stat label="Pha loãng hoàn toàn" value={fmtShares(t.fullyDiluted)} hint="Gồm quyền ESOP còn hiệu lực + bể chưa cấp" />
        <Stat label="Quyền ESOP lưu hành" value={fmtShares(t.optionsOutstanding)} hint={`Bể còn trống: ${fmtShares(t.esopAvailable)}`} />
        <Stat label="Sở hữu nước ngoài" value={fmtPct(t.foreignPct)} />
      </div>

      {view === "holder" ? (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th>Cổ đông</th>
                <th>Nhóm</th>
                {t.classes.map((c) => <th key={c.id} className="text-right">{c.code}</th>)}
                <th className="text-right">Tổng CP</th>
                <th className="text-right">Quyền ESOP</th>
                <th className="text-right">% cơ sở</th>
                <th className="text-right">% pha loãng</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.investorId}>
                  <td>
                    <Link href={`/investors/${r.investorId}`} className="font-medium hover:underline">{r.name}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                      <span className="whitespace-nowrap">{r.code}</span>
                      {r.major && <Badge tone="accent">Cổ đông lớn</Badge>}
                      {r.isForeign && <Badge>Nước ngoài</Badge>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{CATEGORY_LABEL[r.category]}</td>
                  {t.classes.map((c) => (
                    <td key={c.id} className="num text-right">{r.byClass[c.id] ? fmtShares(r.byClass[c.id]) : "—"}</td>
                  ))}
                  <td className="num text-right font-medium">{fmtShares(r.issued)}</td>
                  <td className="num text-right">{r.options ? fmtShares(r.options) : "—"}</td>
                  <td className="num whitespace-nowrap text-right">
                    <span className="mr-2"><InlineBar pct={(r.pctBasic / maxPct) * 100} color={seriesFor(r.category)} /></span>
                    {fmtPct(r.pctBasic, 4)}
                  </td>
                  <td className="num text-right">{fmtPct(r.pctFD, 4)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-semibold">
                <td colSpan={2}>Tổng</td>
                {t.classes.map((c) => <td key={c.id} className="num text-right">{fmtShares(t.classTotals[c.id] ?? 0n)}</td>)}
                <td className="num text-right">{fmtShares(t.issued)}</td>
                <td className="num text-right">{fmtShares(t.optionsOutstanding)}</td>
                <td className="num text-right">100%</td>
                <td className="num text-right">—</td>
              </tr>
            </tbody>
          </TableWrap>
          {t.rows.length === 0 && <Empty>Chưa có giao dịch nào được ghi sổ.</Empty>}
          <p className="mt-2 text-xs text-muted">
            Cổ đông lớn: sở hữu ≥ {t.majorThreshold}% tổng cổ phần đã phát hành (ngưỡng cấu hình được — cần Pháp chế xác nhận theo Điều lệ). Bể ESOP chưa cấp ({fmtShares(t.esopAvailable)}) tính vào mẫu số pha loãng.
          </p>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Theo lớp cổ phần">
            <table className="tbl">
              <thead><tr><th>Lớp</th><th>Loại</th><th className="text-right">Biểu quyết/CP</th><th className="text-right">Số CP</th><th className="text-right">%</th></tr></thead>
              <tbody>
                {t.classes.map((c) => (
                  <tr key={c.id}>
                    <td><div className="font-medium">{c.code}</div><div className="text-xs text-muted">{c.name}</div></td>
                    <td>{c.kind === "COMMON" ? "Phổ thông" : "Ưu đãi"}</td>
                    <td className="num text-right">{c.votesPerShare}</td>
                    <td className="num text-right">{fmtShares(t.classTotals[c.id] ?? 0n)}</td>
                    <td className="num text-right">{fmtPct(pct(t.classTotals[c.id] ?? 0n, t.issued))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Theo nhóm cổ đông">
            <table className="tbl">
              <thead><tr><th>Nhóm</th><th className="text-right">Số NĐT</th><th className="text-right">Số CP</th><th className="text-right">% cơ sở</th><th className="text-right">% pha loãng</th></tr></thead>
              <tbody>
                {[...byCategory.entries()].map(([cat, v]) => (
                  <tr key={cat}>
                    <td>
                      <span className="mr-1.5 inline-block size-2.5 rounded-sm align-middle" style={{ background: seriesFor(cat) }} aria-hidden />
                      {CATEGORY_LABEL[cat]}
                    </td>
                    <td className="num text-right">{v.n}</td>
                    <td className="num text-right">{fmtShares(v.issued)}</td>
                    <td className="num text-right">{fmtPct(pct(v.issued, t.issued))}</td>
                    <td className="num text-right">{fmtPct(pct(v.issued + v.options, t.fullyDiluted))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="text-muted">Bể ESOP chưa cấp</td>
                  <td />
                  <td className="num text-right">{fmtShares(t.esopAvailable)}</td>
                  <td className="num text-right">—</td>
                  <td className="num text-right">{fmtPct(pct(t.esopAvailable, t.fullyDiluted))}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
