import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { fmtPct, fmtShares, STAGE_GROUP, STAGE_LABEL } from "@/lib/format";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { capTable } from "@/server/captable";

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

  const [cap, stages, drafts, kycPending] = await Promise.all([
    showCap ? capTable() : null,
    showInv ? db.investor.groupBy({ by: ["stage"], _count: true }) : [],
    showCap ? db.shareTransaction.count({ where: { status: "DRAFT" } }) : 0,
    showInv ? db.investor.count({ where: { stage: { in: ["SHAREHOLDER", "PARTIAL_EXIT"] }, kycStatus: { not: "VERIFIED" } } }) : 0,
  ]);
  const byStage = Object.fromEntries(stages.map((s) => [s.stage, s._count]));
  const count = (g: string) => Object.entries(byStage).filter(([k]) => STAGE_GROUP[k] === g).reduce((a, [, v]) => a + v, 0);

  return (
    <>
      <PageHeader title="Tổng quan" subtitle="Sức khoẻ cơ cấu vốn và quan hệ nhà đầu tư" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cap && <Stat label="Cổ phần đã phát hành" value={fmtShares(cap.issued)} hint={`Pha loãng hoàn toàn: ${fmtShares(cap.fullyDiluted)}`} />}
        {cap && <Stat label="Cổ đông hiện hữu" value={cap.rows.filter((r) => r.issued > 0n).length} hint={`${cap.rows.filter((r) => r.major).length} cổ đông lớn (≥ ${cap.majorThreshold}%)`} />}
        {cap && <Stat label="Sở hữu nước ngoài" value={fmtPct(cap.foreignPct)} hint="Trên tổng cổ phần đã phát hành" />}
        {cap && <Stat label="Bể ESOP còn trống" value={fmtShares(cap.esopAvailable)} hint={`Quyền đang lưu hành: ${fmtShares(cap.optionsOutstanding)}`} />}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {showInv && (
          <Card title="Phễu nhà đầu tư" actions={<Link href="/investors" className="text-xs text-accent">Xem tất cả</Link>}>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <Badge tone="accent">Tiềm năng: {count("prospect")}</Badge>
              <Badge tone="ok">Đang nắm giữ: {count("holder")}</Badge>
              <Badge>Đã exit: {count("exited")}</Badge>
              <Badge tone="warn">Dừng: {count("dropped")}</Badge>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {Object.keys(STAGE_LABEL).map((s) => (
                <li key={s} className="flex justify-between border-b border-line py-1">
                  <Link href={`/investors?stage=${s}`} className="text-muted hover:text-ink">{STAGE_LABEL[s]}</Link>
                  <span className="num font-medium">{byStage[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Cần xử lý">
          <ul className="space-y-2 text-sm">
            {showCap && (
              <li className="flex items-center justify-between">
                <Link href="/transactions?status=DRAFT" className="hover:underline">Giao dịch nháp chờ ghi sổ</Link>
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
          {cap && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-muted">Top cổ đông (cơ sở)</div>
              <ul className="space-y-1 text-sm">
                {cap.rows.slice(0, 5).map((r) => (
                  <li key={r.investorId} className="flex justify-between gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="num">{fmtPct(r.pctBasic)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
