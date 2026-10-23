import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { fmtPct, fmtShares } from "@/lib/format";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { Columns, Funnel, InlineBar, ShareBar, StackedColumns } from "@/components/charts/charts";
import { capTable } from "@/server/captable";
import {
  CATEGORY_SERIES, ESOP_POOL_SERIES, fmtUsdCompact, ownershipByCategory, ownershipHistory, pipeline, valuationHistory,
} from "@/server/analytics";

export const metadata: Metadata = { title: "Tổng quan" };

export default async function Dashboard() {
  const u = await requireInternal();
  const showCap = can(u, "captable.view");
  const showInv = can(u, "investors.view");

  if (!showCap && !showInv) {
    return (
      <>
        <PageHeader title={`Xin chào, ${u.name}`} subtitle="Vai trò của bạn không có quyền xem dữ liệu vốn." />
        <Card>Dùng menu bên trái để vào các mục được cấp quyền.</Card>
      </>
    );
  }

  const [cap, mix, history, valuation, funnel, drafts, kycPending, recent] = await Promise.all([
    showCap ? capTable() : null,
    showCap ? ownershipByCategory() : null,
    showCap ? ownershipHistory() : [],
    showCap && u.seeMoney ? valuationHistory() : [],
    showInv ? pipeline() : [],
    showCap ? db.shareTransaction.count({ where: { status: "DRAFT" } }) : 0,
    showInv ? db.investor.count({ where: { stage: { in: ["SHAREHOLDER", "PARTIAL_EXIT"] }, kycStatus: { not: "VERIFIED" } } }) : 0,
    showInv
      ? db.interaction.findMany({ orderBy: { date: "desc" }, take: 5, include: { investor: { select: { id: true, name: true } }, user: { select: { name: true } } } })
      : [],
  ]);
  const latest = valuation.at(-1);
  const raisedTotal = valuation.reduce((a, v) => a + v.raised, 0);
  const historySeries = CATEGORY_SERIES.filter((s) => history.some((h) => (h.parts[s.key] ?? 0) > 0));

  return (
    <>
      <PageHeader title="Tổng quan" subtitle="Sức khoẻ cơ cấu vốn và quan hệ nhà đầu tư" />

      {cap && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {latest ? (
            <Stat label="Định giá gần nhất (post-money)" value={fmtUsdCompact(latest.postMoney)} hint={`${latest.label} · ${latest.sub}`} />
          ) : (
            <Stat label="Cổ phần đã phát hành" value={fmtShares(cap.issued)} hint={`Pha loãng hoàn toàn: ${fmtShares(cap.fullyDiluted)}`} />
          )}
          {u.seeMoney && raisedTotal > 0 ? (
            <Stat label="Vốn đã huy động (USD)" value={fmtUsdCompact(raisedTotal)} hint={`Qua ${valuation.length} vòng định giá USD`} />
          ) : (
            <Stat label="Pha loãng hoàn toàn" value={fmtShares(cap.fullyDiluted)} hint="Gồm quyền ESOP + bể chưa cấp" />
          )}
          <Stat label="Cổ đông hiện hữu" value={cap.rows.filter((r) => r.issued > 0n).length} hint={`${cap.rows.filter((r) => r.major).length} cổ đông lớn (≥ ${cap.majorThreshold}%)`} />
          <Stat label="Sở hữu nước ngoài" value={fmtPct(cap.foreignPct)} hint="Trên cổ phần đã phát hành" />
        </div>
      )}

      {mix && (
        <Card title="Cơ cấu sở hữu — pha loãng hoàn toàn" className="mt-4" actions={<Link href="/captable?view=class" className="text-xs text-accent">Chi tiết</Link>}>
          <ShareBar
            series={[...CATEGORY_SERIES, ESOP_POOL_SERIES]}
            parts={mix.parts}
            tipDetail={Object.fromEntries(Object.entries(mix.shares).map(([k, v]) => [k, `${fmtShares(v)} cổ phần`]))}
          />
        </Card>
      )}

      {showCap && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Cơ cấu sở hữu sau từng vòng (cơ sở)">
            {history.length > 1 ? <StackedColumns series={historySeries} columns={history} /> : <p className="text-sm text-muted">Chưa đủ dữ liệu vòng gọi vốn.</p>}
          </Card>
          {u.seeMoney && valuation.length > 0 ? (
            <Card title="Định giá sau vốn qua các vòng (USD)">
              <Columns
                columns={valuation.map((v) => ({ key: v.key, label: v.label, sub: v.sub, value: v.postMoney }))}
                format={fmtUsdCompact}
                tip={(c) => {
                  const v = valuation.find((x) => x.label === c.label)!;
                  return `${v.label} (${v.sub})|Post-money ${fmtUsdCompact(v.postMoney)}|Huy động ${fmtUsdCompact(v.raised)}`;
                }}
              />
            </Card>
          ) : (
            showInv && <Card title="Phễu nhà đầu tư tiềm năng"><Funnel stages={funnel} /></Card>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {showInv && u.seeMoney && showCap && (
          <Card title="Phễu nhà đầu tư tiềm năng" actions={<Link href="/investors?group=prospect" className="text-xs text-accent">Xem</Link>}>
            <Funnel stages={funnel} />
          </Card>
        )}

        {cap && (
          <Card title="Cổ đông lớn nhất">
            <ul className="space-y-2 text-sm">
              {cap.rows.filter((r) => r.issued > 0n).slice(0, 6).map((r) => (
                <li key={r.investorId} className="flex items-center justify-between gap-2">
                  <Link href={`/investors/${r.investorId}`} className="truncate hover:underline">{r.name}</Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <InlineBar pct={r.pctBasic * 2.5} />
                    <span className="num w-14 text-right">{fmtPct(r.pctBasic)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Cần xử lý">
          <ul className="space-y-2 text-sm">
            {showCap && (
              <li className="flex items-center justify-between">
                <Link href="/transactions?status=DRAFT" className="hover:underline">Giao dịch chờ ghi sổ</Link>
                <Badge tone={drafts ? "warn" : "neutral"}>{drafts}</Badge>
              </li>
            )}
            {showInv && (
              <li className="flex items-center justify-between">
                <Link href="/investors?kyc=missing" className="hover:underline">Cổ đông chưa hoàn tất KYC</Link>
                <Badge tone={kycPending ? "warn" : "neutral"}>{kycPending}</Badge>
              </li>
            )}
          </ul>
          {recent.length > 0 && (
            <>
              <div className="mb-1.5 mt-4 text-xs font-medium text-muted">Tương tác gần đây</div>
              <ul className="space-y-2 text-sm">
                {recent.map((i) => (
                  <li key={i.id}>
                    <Link href={`/investors/${i.investor.id}`} className="font-medium hover:underline">{i.investor.name}</Link>
                    <div className="line-clamp-2 text-xs text-muted">{i.summary}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
