// Công thức Cap Table thuần (không I/O) để test được độc lập.
// Số cổ phần luôn là bigint; tiền dùng chuỗi thập phân → bigint có scale, không dùng float.

export type LedgerKind = "ISSUE" | "TRANSFER" | "REDEMPTION";

export type LedgerRow = {
  seq: number;
  kind: LedgerKind;
  shareClassId: string;
  quantity: bigint;
  fromInvestorId: string | null;
  toInvestorId: string | null;
};

/** holder → (class → số cổ phần). */
export type Holdings = Map<string, Map<string, bigint>>;

function bump(h: Holdings, holder: string, cls: string, delta: bigint) {
  const byClass = h.get(holder) ?? new Map<string, bigint>();
  byClass.set(cls, (byClass.get(cls) ?? 0n) + delta);
  h.set(holder, byClass);
}

/**
 * Cộng dồn sổ cái theo thứ tự seq. Nếu bất kỳ lúc nào một cổ đông bị âm cổ phần → lỗi toàn vẹn dữ liệu.
 */
export function computeHoldings(rows: readonly LedgerRow[]): Holdings {
  const h: Holdings = new Map();
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (r.quantity <= 0n) throw new Error(`Giao dịch #${r.seq}: số lượng phải > 0`);
    if (r.kind === "ISSUE" || r.kind === "TRANSFER") {
      if (!r.toInvestorId) throw new Error(`Giao dịch #${r.seq}: thiếu bên nhận`);
      bump(h, r.toInvestorId, r.shareClassId, r.quantity);
    }
    if (r.kind === "TRANSFER" || r.kind === "REDEMPTION") {
      if (!r.fromInvestorId) throw new Error(`Giao dịch #${r.seq}: thiếu bên chuyển`);
      bump(h, r.fromInvestorId, r.shareClassId, -r.quantity);
      const left = h.get(r.fromInvestorId)!.get(r.shareClassId)!;
      if (left < 0n) throw new Error(`Giao dịch #${r.seq}: bên chuyển không đủ cổ phần`);
    }
  }
  return h;
}

export const holderTotal = (byClass: Map<string, bigint> | undefined) =>
  [...(byClass?.values() ?? [])].reduce((a, b) => a + b, 0n);

export function totalsByClass(h: Holdings): Map<string, bigint> {
  const t = new Map<string, bigint>();
  for (const byClass of h.values()) {
    for (const [cls, q] of byClass) t.set(cls, (t.get(cls) ?? 0n) + q);
  }
  return t;
}

export const totalIssued = (h: Holdings) => [...totalsByClass(h).values()].reduce((a, b) => a + b, 0n);

/** Tỷ lệ %, làm tròn 4 chữ số thập phân, tính bằng bigint để không lệch số. */
export function pct(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  const scaled = (part * 1_000_000n * 2n + total) / (total * 2n); // làm tròn nửa lên
  return Number(scaled) / 10_000;
}

// ───────────── ESOP

export type Frequency = "MONTHLY" | "QUARTERLY" | "YEARLY";
const PERIOD: Record<Frequency, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** Số tháng tròn giữa 2 ngày (UTC). */
export function fullMonthsBetween(from: Date, to: Date): number {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

export type GrantInput = {
  quantity: bigint;
  vestingStart: Date;
  cliffMonths: number;
  vestingMonths: number;
  frequency: Frequency;
  status: "ACTIVE" | "TERMINATED" | "CANCELLED";
  terminatedAt: Date | null;
};

/** Số quyền đã vest tại ngày asOf. Nghỉ việc → dừng vest ở ngày nghỉ. Trước cliff = 0. */
export function vestedQuantity(g: GrantInput, asOf: Date): bigint {
  if (g.status === "CANCELLED") return 0n;
  const end = g.terminatedAt && g.terminatedAt < asOf ? g.terminatedAt : asOf;
  if (end < g.vestingStart) return 0n;
  const months = fullMonthsBetween(g.vestingStart, end);
  if (months < g.cliffMonths) return 0n;
  if (months >= g.vestingMonths) return g.quantity;
  const per = PERIOD[g.frequency];
  const totalPeriods = BigInt(Math.ceil(g.vestingMonths / per));
  const done = BigInt(Math.floor(months / per));
  return (g.quantity * done) / totalPeriods;
}

export type GrantSummary = {
  vested: bigint;
  unvested: bigint;
  exercised: bigint;
  exercisable: bigint;
  forfeited: bigint; // quay về pool
  outstanding: bigint; // quyền chọn còn hiệu lực (chưa thực hiện, chưa bị thu hồi)
};

export function grantSummary(g: GrantInput, exercised: bigint, asOf: Date): GrantSummary {
  const vested = vestedQuantity(g, asOf);
  if (exercised > vested && g.status !== "CANCELLED") {
    throw new Error("Số đã thực hiện vượt số đã vest");
  }
  const forfeited =
    g.status === "CANCELLED"
      ? g.quantity - exercised
      : g.status === "TERMINATED" && g.terminatedAt && g.terminatedAt <= asOf
        ? g.quantity - vested
        : 0n;
  const outstanding = g.quantity - exercised - forfeited;
  return {
    vested,
    unvested: g.quantity - vested - (g.status === "TERMINATED" ? forfeited : 0n),
    exercised,
    exercisable: g.status === "CANCELLED" ? 0n : vested - exercised,
    forfeited,
    outstanding,
  };
}

export function poolSummary(poolSize: bigint, grants: { quantity: bigint; forfeited: bigint }[]) {
  const granted = grants.reduce((a, g) => a + g.quantity, 0n);
  const forfeited = grants.reduce((a, g) => a + g.forfeited, 0n);
  const available = poolSize - (granted - forfeited);
  return { poolSize, granted, forfeited, available };
}

/** Fully diluted = đã phát hành + quyền chọn còn hiệu lực + phần pool chưa cấp. (SAFE tính riêng.) */
export const fullyDiluted = (issued: bigint, optionsOutstanding: bigint, poolAvailable: bigint) =>
  issued + optionsOutstanding + (poolAvailable > 0n ? poolAvailable : 0n);

// ───────────── SAFE / Convertible (ước tính)

const SCALE = 1_000_000n;

/** "1234.56" → 1234560000n (scale 10^6). Chặn đầu vào không phải số thập phân. */
export function toScaled(v: string): bigint {
  const s = v.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`Số không hợp lệ: ${v}`);
  const [i, f = ""] = s.split(".");
  return BigInt(i) * SCALE + BigInt(f.padEnd(6, "0"));
}

/**
 * Số cổ phần SAFE nhận được trong một vòng định giá: lấy giá có lợi hơn cho NĐT
 * giữa giá trần (cap / capitalization) và giá chiết khấu (giá vòng × (1 − d%)).
 * Đây là ước tính cho mô phỏng; con số chính thức theo điều khoản hợp đồng cụ thể.
 */
export function safeConversionShares(p: {
  principal: string;
  valuationCap?: string | null;
  discountPct?: string | null;
  roundPrice: string;
  capitalizationShares: bigint;
}): { shares: bigint; basis: "cap" | "discount" | "round" } {
  const principal = toScaled(p.principal);
  const roundPrice = toScaled(p.roundPrice);
  if (roundPrice <= 0n) throw new Error("Giá vòng phải > 0");
  // So sánh số cổ phần thay vì giá để tránh chia mất độ chính xác.
  let best = { shares: principal / roundPrice, basis: "round" as "cap" | "discount" | "round" };
  if (p.valuationCap && p.capitalizationShares > 0n) {
    const cap = toScaled(p.valuationCap);
    const s = (principal * p.capitalizationShares) / cap;
    if (s > best.shares) best = { shares: s, basis: "cap" };
  }
  if (p.discountPct) {
    const d = toScaled(p.discountPct); // 20 → 20.000000
    const discPrice = (roundPrice * (100n * SCALE - d)) / (100n * SCALE);
    if (discPrice > 0n) {
      const s = principal / discPrice;
      if (s > best.shares) best = { shares: s, basis: "discount" };
    }
  }
  return best;
}
