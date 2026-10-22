import { describe, expect, it } from "vitest";
import {
  computeHoldings,
  fullMonthsBetween,
  fullyDiluted,
  grantSummary,
  holderTotal,
  pct,
  poolSummary,
  safeConversionShares,
  totalIssued,
  vestedQuantity,
  type GrantInput,
  type LedgerRow,
} from "./cap-math";

const row = (seq: number, r: Partial<LedgerRow>): LedgerRow => ({
  seq,
  kind: "ISSUE",
  shareClassId: "C",
  quantity: 0n,
  fromInvestorId: null,
  toInvestorId: null,
  ...r,
});

describe("computeHoldings", () => {
  it("cộng phát hành, chuyển nhượng, mua lại", () => {
    const h = computeHoldings([
      row(1, { toInvestorId: "A", quantity: 6_000_000n }),
      row(2, { toInvestorId: "B", quantity: 4_000_000n, shareClassId: "P" }),
      row(3, { kind: "TRANSFER", fromInvestorId: "A", toInvestorId: "C", quantity: 1_000_000n }),
      row(4, { kind: "REDEMPTION", fromInvestorId: "B", quantity: 500_000n, shareClassId: "P" }),
    ]);
    expect(holderTotal(h.get("A"))).toBe(5_000_000n);
    expect(holderTotal(h.get("C"))).toBe(1_000_000n);
    expect(holderTotal(h.get("B"))).toBe(3_500_000n);
    expect(totalIssued(h)).toBe(9_500_000n);
  });

  it("áp dụng theo seq, không theo thứ tự mảng", () => {
    const h = computeHoldings([
      row(2, { kind: "TRANSFER", fromInvestorId: "A", toInvestorId: "B", quantity: 10n }),
      row(1, { toInvestorId: "A", quantity: 10n }),
    ]);
    expect(holderTotal(h.get("B"))).toBe(10n);
  });

  it("chặn chuyển quá số đang nắm", () => {
    expect(() =>
      computeHoldings([
        row(1, { toInvestorId: "A", quantity: 10n }),
        row(2, { kind: "TRANSFER", fromInvestorId: "A", toInvestorId: "B", quantity: 11n }),
      ]),
    ).toThrow(/không đủ/);
  });

  it("chặn chuyển cổ phần sai lớp", () => {
    expect(() =>
      computeHoldings([
        row(1, { toInvestorId: "A", quantity: 10n, shareClassId: "C" }),
        row(2, { kind: "TRANSFER", fromInvestorId: "A", toInvestorId: "B", quantity: 5n, shareClassId: "P" }),
      ]),
    ).toThrow(/không đủ/);
  });
});

describe("pct", () => {
  it("tổng các phần = 100%", () => {
    const parts = [1n, 1n, 1n];
    const total = 3n;
    const sum = parts.reduce((a, p) => a + pct(p, total), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.001);
  });
  it("làm tròn 4 chữ số", () => {
    expect(pct(1n, 3n)).toBe(33.3333);
    expect(pct(2n, 3n)).toBe(66.6667);
    expect(pct(0n, 0n)).toBe(0);
  });
});

describe("vesting", () => {
  const base: GrantInput = {
    quantity: 48_000n,
    vestingStart: new Date(Date.UTC(2024, 0, 15)),
    cliffMonths: 12,
    vestingMonths: 48,
    frequency: "MONTHLY",
    status: "ACTIVE",
    terminatedAt: null,
  };

  it("đếm tháng tròn", () => {
    expect(fullMonthsBetween(new Date(Date.UTC(2024, 0, 15)), new Date(Date.UTC(2024, 1, 14)))).toBe(0);
    expect(fullMonthsBetween(new Date(Date.UTC(2024, 0, 15)), new Date(Date.UTC(2024, 1, 15)))).toBe(1);
  });

  it("trước cliff = 0, đúng cliff = 12/48", () => {
    expect(vestedQuantity(base, new Date(Date.UTC(2025, 0, 14)))).toBe(0n);
    expect(vestedQuantity(base, new Date(Date.UTC(2025, 0, 15)))).toBe(12_000n);
  });

  it("vest đủ sau 48 tháng và không vượt tổng", () => {
    expect(vestedQuantity(base, new Date(Date.UTC(2028, 0, 15)))).toBe(48_000n);
    expect(vestedQuantity(base, new Date(Date.UTC(2035, 0, 1)))).toBe(48_000n);
  });

  it("theo quý chỉ nhảy mỗi 3 tháng", () => {
    const q = { ...base, frequency: "QUARTERLY" as const };
    expect(vestedQuantity(q, new Date(Date.UTC(2025, 2, 15)))).toBe(12_000n); // 14 tháng → 4 quý
    expect(vestedQuantity(q, new Date(Date.UTC(2025, 3, 15)))).toBe(15_000n); // 15 tháng → 5 quý
  });

  it("nghỉ việc: dừng vest, phần còn lại thu hồi về pool", () => {
    const t: GrantInput = { ...base, status: "TERMINATED", terminatedAt: new Date(Date.UTC(2026, 0, 15)) };
    const s = grantSummary(t, 4_000n, new Date(Date.UTC(2027, 0, 1)));
    expect(s.vested).toBe(24_000n);
    expect(s.forfeited).toBe(24_000n);
    expect(s.exercisable).toBe(20_000n);
    expect(s.outstanding).toBe(20_000n);
  });

  it("không cho thực hiện quá phần đã vest", () => {
    expect(() => grantSummary(base, 1n, new Date(Date.UTC(2024, 5, 1)))).toThrow();
  });

  it("pool & fully diluted", () => {
    const p = poolSummary(100_000n, [
      { quantity: 48_000n, forfeited: 24_000n },
      { quantity: 30_000n, forfeited: 0n },
    ]);
    expect(p.available).toBe(46_000n);
    expect(fullyDiluted(1_000_000n, 54_000n, p.available)).toBe(1_100_000n);
  });
});

describe("SAFE", () => {
  it("dùng giá trần khi có lợi hơn", () => {
    // $500k, cap $10M, 10M cổ phần → giá trần $1; giá vòng $2 → nhận 500k cổ phần theo cap
    const r = safeConversionShares({
      principal: "500000",
      valuationCap: "10000000",
      discountPct: "20",
      roundPrice: "2",
      capitalizationShares: 10_000_000n,
    });
    expect(r).toEqual({ shares: 500_000n, basis: "cap" });
  });

  it("dùng chiết khấu khi có lợi hơn", () => {
    const r = safeConversionShares({
      principal: "100000",
      valuationCap: "50000000",
      discountPct: "20",
      roundPrice: "1",
      capitalizationShares: 10_000_000n,
    });
    expect(r).toEqual({ shares: 125_000n, basis: "discount" });
  });

  it("từ chối số không hợp lệ", () => {
    expect(() =>
      safeConversionShares({ principal: "1e6", roundPrice: "1", capitalizationShares: 1n }),
    ).toThrow();
  });
});
