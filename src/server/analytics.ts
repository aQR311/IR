import "server-only";
import { db } from "@/lib/db";
import { computeHoldings, pct, totalIssued } from "@/lib/cap-math";
import { STAGE_LABEL } from "@/lib/format";
import { esopState } from "./captable";

// Nhóm cổ đông → slot màu cố định (thứ tự = thứ tự đã kiểm định CVD; không đảo).
export const CATEGORY_SERIES = [
  { key: "FOUNDER", label: "Sáng lập", color: "var(--series-1)" },
  { key: "VC", label: "Quỹ VC", color: "var(--series-2)" },
  { key: "STRATEGIC", label: "Chiến lược", color: "var(--series-3)" },
  { key: "ANGEL", label: "Angel", color: "var(--series-4)" },
  { key: "EMPLOYEE", label: "Nhân viên", color: "var(--series-5)" },
  { key: "OTHER", label: "Khác", color: "var(--series-6)" },
] as const;
export const ESOP_POOL_SERIES = { key: "ESOP_POOL", label: "Bể ESOP (chưa thực hiện)", color: "var(--series-muted)" };

/** Cơ cấu sở hữu pha loãng hoàn toàn theo nhóm, kèm bể ESOP (quyền còn hiệu lực + phần chưa cấp). */
export async function ownershipByCategory() {
  const [ledger, esop, investors] = await Promise.all([
    db.shareTransaction.findMany({ where: { status: "POSTED" }, select: { seq: true, kind: true, shareClassId: true, quantity: true, fromInvestorId: true, toInvestorId: true } }),
    esopState(),
    db.investor.findMany({ select: { id: true, category: true } }),
  ]);
  const cat = new Map(investors.map((i) => [i.id, i.category as string]));
  const holdings = computeHoldings(ledger);
  const issued = totalIssued(holdings);
  const pool = esop.optionsOutstanding + (esop.pool.available > 0n ? esop.pool.available : 0n);
  const fd = issued + pool;
  const shares: Record<string, bigint> = {};
  for (const [id, byClass] of holdings) {
    const c = cat.get(id) ?? "OTHER";
    shares[c] = (shares[c] ?? 0n) + [...byClass.values()].reduce((a, b) => a + b, 0n);
  }
  shares[ESOP_POOL_SERIES.key] = pool;
  return {
    fd,
    shares,
    parts: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, pct(v, fd)])),
  };
}

/** Nhãn trục X ngắn gọn: "Vòng Series A" → "Series A", "Góp vốn thành lập" → "Thành lập". */
const shortRound = (name: string) => {
  const s = name.replace(/^(Vòng|Góp vốn)\s+/i, "");
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 14);
};

/** Cơ cấu sở hữu (cơ sở) ngay sau mỗi vòng đã đóng — cho thấy mức pha loãng qua thời gian. */
export async function ownershipHistory() {
  const [rounds, ledger, investors] = await Promise.all([
    db.fundingRound.findMany({ where: { status: "CLOSED", closeDate: { not: null } }, orderBy: { closeDate: "asc" } }),
    db.shareTransaction.findMany({
      where: { status: "POSTED" },
      select: { seq: true, kind: true, shareClassId: true, quantity: true, fromInvestorId: true, toInvestorId: true, date: true },
    }),
    db.investor.findMany({ select: { id: true, category: true } }),
  ]);
  const cat = new Map(investors.map((i) => [i.id, i.category as string]));
  // Lịch sử nhập sau (import) có thể có seq không theo thứ tự ngày → xếp lại theo ngày hiệu lực.
  const byDate = [...ledger]
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq)
    .map((t, i) => ({ ...t, seq: i + 1 }));
  const points = [...rounds.map((r) => ({ key: r.code, label: r.name, at: r.closeDate! })), { key: "NOW", label: "Hiện tại", at: new Date() }];
  return points.map((p) => {
    const h = computeHoldings(byDate.filter((t) => t.date <= p.at));
    const issued = totalIssued(h);
    const byCat: Record<string, bigint> = {};
    for (const [id, byClass] of h) {
      const c = cat.get(id) ?? "OTHER";
      byCat[c] = (byCat[c] ?? 0n) + [...byClass.values()].reduce((a, b) => a + b, 0n);
    }
    return {
      key: p.key,
      label: shortRound(p.label),
      sub: p.at.getUTCFullYear().toString(),
      parts: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, pct(v, issued)])),
    };
  });
}

/** Định giá sau vốn (post-money) các vòng có định giá bằng USD. */
export async function valuationHistory() {
  const rounds = await db.fundingRound.findMany({
    where: { status: "CLOSED", currency: "USD", preMoney: { not: null } },
    orderBy: { closeDate: "asc" },
    include: { transactions: { where: { status: "POSTED", kind: "ISSUE", currency: "USD" }, select: { amount: true } } },
  });
  return rounds.map((r) => {
    const raised = r.transactions.reduce((a, t) => a + Number(t.amount ?? 0), 0);
    return {
      key: r.code,
      label: shortRound(r.name),
      sub: r.closeDate?.getUTCFullYear().toString(),
      raised,
      postMoney: Number(r.preMoney) + raised,
    };
  });
}

const PIPELINE = ["LEAD", "CONTACTED", "NDA", "DUE_DILIGENCE", "TERM_SHEET", "COMMITTED"] as const;

export async function pipeline() {
  // Phễu gọi vốn chỉ tính nhà đầu tư bên ngoài — nhân sự giữ ESOP không phải "tiềm năng".
  const g = await db.investor.groupBy({ by: ["stage"], where: { category: { notIn: ["EMPLOYEE", "FOUNDER"] } }, _count: true });
  const n = Object.fromEntries(g.map((x) => [x.stage, x._count]));
  return PIPELINE.map((s) => ({ key: s, label: STAGE_LABEL[s], value: n[s] ?? 0, href: `/investors?stage=${s}` }));
}

export const fmtUsdCompact = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`
  : v >= 1e6 ? `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`
  : v >= 1e3 ? `$${(v / 1e3).toLocaleString("en-US", { maximumFractionDigits: 0 })}K`
  : `$${v}`;
