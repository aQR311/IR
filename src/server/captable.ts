import "server-only";
import { db, type Tx } from "@/lib/db";
import {
  computeHoldings,
  fullyDiluted,
  grantSummary,
  holderTotal,
  pct,
  poolSummary,
  totalIssued,
  totalsByClass,
  type LedgerRow,
} from "@/lib/cap-math";

export const MAJOR_DEFAULT_PCT = 5;

export async function majorThresholdPct(): Promise<number> {
  const s = await db.appSetting.findUnique({ where: { key: "major_shareholder_pct" } });
  const v = Number(s?.value);
  return Number.isFinite(v) && v > 0 ? v : MAJOR_DEFAULT_PCT;
}

export async function postedLedger(tx: Tx | typeof db = db): Promise<LedgerRow[]> {
  const rows = await tx.shareTransaction.findMany({
    where: { status: "POSTED" },
    orderBy: { seq: "asc" },
    select: { seq: true, kind: true, shareClassId: true, quantity: true, fromInvestorId: true, toInvestorId: true },
  });
  return rows;
}

export async function esopState(asOf = new Date()) {
  const [pools, grants] = await Promise.all([
    db.esopPool.findMany({ orderBy: { approvedAt: "asc" } }),
    db.esopGrant.findMany({
      orderBy: { grantDate: "asc" },
      include: {
        holder: { select: { id: true, name: true, code: true } },
        exercises: { where: { status: "POSTED" }, select: { quantity: true } },
      },
    }),
  ]);
  const enriched = grants.map((g) => {
    const exercised = g.exercises.reduce((a, e) => a + e.quantity, 0n);
    return { grant: g, summary: grantSummary(g, exercised, asOf) };
  });
  const poolSize = pools.reduce((a, p) => a + p.size, 0n);
  const pool = poolSummary(
    poolSize,
    enriched.map((e) => ({ quantity: e.grant.quantity, forfeited: e.summary.forfeited })),
  );
  const optionsOutstanding = enriched.reduce((a, e) => a + e.summary.outstanding, 0n);
  return { pools, grants: enriched, pool, optionsOutstanding };
}

export type CapRow = {
  investorId: string;
  code: string;
  name: string;
  category: string;
  isForeign: boolean;
  byClass: Record<string, bigint>;
  issued: bigint;
  options: bigint;
  pctBasic: number;
  pctFD: number;
  major: boolean;
};

/**
 * Bảng vốn đầy đủ. Chỉ số lượng & tỷ lệ — không chứa trường tiền, nên an toàn cho mọi người có captable.view.
 * Người gọi phải kiểm tra quyền captable.view trước.
 */
export async function capTable() {
  const [ledger, classes, esop, threshold] = await Promise.all([
    postedLedger(),
    db.shareClass.findMany({ orderBy: [{ seniority: "desc" }, { code: "asc" }] }),
    esopState(),
    majorThresholdPct(),
  ]);
  const holdings = computeHoldings(ledger);
  const issued = totalIssued(holdings);
  const fd = fullyDiluted(issued, esop.optionsOutstanding, esop.pool.available);

  const optionsByHolder = new Map<string, bigint>();
  for (const g of esop.grants) {
    optionsByHolder.set(g.grant.holderId, (optionsByHolder.get(g.grant.holderId) ?? 0n) + g.summary.outstanding);
  }
  const ids = new Set([...holdings.keys(), ...optionsByHolder.keys()]);
  const investors = await db.investor.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, code: true, name: true, category: true, isForeign: true },
  });

  const rows: CapRow[] = investors
    .map((inv) => {
      const byClassMap = holdings.get(inv.id);
      const own = holderTotal(byClassMap);
      const options = optionsByHolder.get(inv.id) ?? 0n;
      const basic = pct(own, issued);
      return {
        investorId: inv.id,
        code: inv.code,
        name: inv.name,
        category: inv.category,
        isForeign: inv.isForeign,
        byClass: Object.fromEntries(byClassMap ?? []),
        issued: own,
        options,
        pctBasic: basic,
        pctFD: pct(own + options, fd),
        major: basic >= threshold,
      };
    })
    .filter((r) => r.issued > 0n || r.options > 0n)
    .sort((a, b) => (b.issued + b.options > a.issued + a.options ? 1 : -1));

  const classTotals = totalsByClass(holdings);
  const foreignIssued = rows.filter((r) => r.isForeign).reduce((a, r) => a + r.issued, 0n);

  return {
    classes,
    rows,
    classTotals: Object.fromEntries(classTotals),
    issued,
    fullyDiluted: fd,
    esopAvailable: esop.pool.available,
    optionsOutstanding: esop.optionsOutstanding,
    majorThreshold: threshold,
    foreignPct: pct(foreignIssued, issued),
  };
}

/** Số dư hiện tại của một NĐT (dùng cho trang chi tiết & cổng NĐT). */
export async function holdingOf(investorId: string) {
  const holdings = computeHoldings(await postedLedger());
  const issued = totalIssued(holdings);
  const mine = holdings.get(investorId);
  const own = holderTotal(mine);
  return { byClass: Object.fromEntries(mine ?? []), total: own, pct: pct(own, issued), issued };
}
