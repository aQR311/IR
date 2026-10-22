// Dữ liệu mẫu HƯ CẤU cho môi trường dev. Chạy: npm run db:seed (hoặc db:reset-local để làm lại từ đầu).
// Từ chối chạy ở production hoặc trên DB không phải máy local.
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { encryptField } from "../src/lib/crypto";
import { audit } from "../src/lib/audit";

const db = new PrismaClient();

function guard() {
  const url = process.env.DATABASE_URL ?? "";
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  if (process.env.NODE_ENV === "production" || (!local && process.env.ALLOW_DEMO_SEED !== "true")) {
    throw new Error("Seed demo chỉ chạy trên DB local (hoặc đặt ALLOW_DEMO_SEED=true cho môi trường thử nghiệm).");
  }
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const inDays = (n: number) => new Date(Date.now() + n * 86400_000);

async function main() {
  guard();
  if ((await db.investor.count()) > 0) {
    console.log("DB đã có dữ liệu — bỏ qua. Dùng `npm run db:reset-local` để làm lại từ đầu.");
    return;
  }

  // ── Tài khoản
  const users = {
    it: { email: "it.admin@appota.com", name: "Quản trị IT (demo)", role: "SYS_ADMIN" },
    ceo: { email: "ceo.demo@appota.com", name: "CEO (demo)", role: "EXEC" },
    cfo: { email: "cfo.demo@appota.com", name: "CFO (demo)", role: "EXEC" },
    irLead: { email: "ir.lead@appota.com", name: "Trưởng IR (demo)", role: "IR_LEAD" },
    irStaff: { email: "ir.staff@appota.com", name: "Chuyên viên IR (demo)", role: "IR_STAFF" },
    legal: { email: "legal@appota.com", name: "Pháp chế (demo)", role: "LEGAL" },
    finance: { email: "finance@appota.com", name: "Kế toán (demo)", role: "FINANCE" },
    hr: { email: "hr.esop@appota.com", name: "C&B ESOP (demo)", role: "HR_ESOP" },
  } as const;
  const U: Record<string, string> = {};
  for (const [k, v] of Object.entries(users)) {
    U[k] = (await db.user.create({ data: { ...v, kind: "INTERNAL" } })).id;
  }

  // ── Lớp cổ phần & vòng vốn
  const cls = {
    common: await db.shareClass.create({ data: { code: "CP_PT", name: "Cổ phần phổ thông", kind: "COMMON" } }),
    seed: await db.shareClass.create({ data: { code: "UD_SEED", name: "Cổ phần ưu đãi Seed", kind: "PREFERRED", liquidationPrefX: 1, seniority: 1 } }),
    a: await db.shareClass.create({ data: { code: "UD_A", name: "Cổ phần ưu đãi Series A", kind: "PREFERRED", liquidationPrefX: 1, seniority: 2 } }),
  };
  const round = {
    found: await db.fundingRound.create({ data: { code: "FOUNDING", name: "Góp vốn thành lập", status: "CLOSED", closeDate: D("2011-03-01"), pricePerShare: 10000 } }),
    seed: await db.fundingRound.create({ data: { code: "SEED_2014", name: "Vòng Seed", status: "CLOSED", closeDate: D("2014-06-15"), currency: "USD", preMoney: 3_000_000, pricePerShare: 1.2 } }),
    a: await db.fundingRound.create({ data: { code: "SERIES_A_2018", name: "Vòng Series A", status: "CLOSED", closeDate: D("2018-09-20"), currency: "USD", preMoney: 18_000_000, pricePerShare: 4.5 } }),
    b: await db.fundingRound.create({ data: { code: "SERIES_B_2027", name: "Vòng Series B (dự kiến)", status: "OPEN", currency: "USD", targetAmount: 15_000_000 } }),
  };

  // ── Nhà đầu tư (hư cấu)
  type Inv = Omit<Prisma.InvestorCreateInput, "code">;
  const list: [string, Inv][] = [
    ["an", { name: "Nguyễn Văn An", type: "INDIVIDUAL", category: "FOUNDER", kycStatus: "VERIFIED" }],
    ["binh", { name: "Trần Thị Bình", type: "INDIVIDUAL", category: "FOUNDER", kycStatus: "VERIFIED" }],
    ["cuong", { name: "Lê Minh Cường", type: "INDIVIDUAL", category: "FOUNDER", kycStatus: "VERIFIED" }],
    ["alpha", { name: "Alpha Ventures Fund I (demo)", type: "ORGANIZATION", category: "VC", isForeign: true, country: "SG", kycStatus: "VERIFIED", email: "ir@alphaventures-demo.com" }],
    ["beta", { name: "Beta Capital Partners (demo)", type: "ORGANIZATION", category: "VC", isForeign: true, country: "JP", kycStatus: "PENDING" }],
    ["gamma", { name: "Công ty CP Gamma Media (demo)", type: "ORGANIZATION", category: "STRATEGIC", kycStatus: "VERIFIED", taxCode: "0100000000" }],
    ["dung", { name: "Phạm Quốc Dũng", type: "INDIVIDUAL", category: "ANGEL", kycStatus: "NOT_STARTED" }],
    ["ha", { name: "Hoàng Thu Hà", type: "INDIVIDUAL", category: "ANGEL", kycStatus: "VERIFIED" }],
    ["delta", { name: "Delta Growth Fund (demo)", type: "ORGANIZATION", category: "VC", isForeign: true, country: "KR", stage: "DUE_DILIGENCE" }],
    ["epsilon", { name: "Epsilon Partners (demo)", type: "ORGANIZATION", category: "VC", isForeign: true, country: "US", stage: "LEAD" }],
    ["omega", { name: "Omega Holdings (demo)", type: "ORGANIZATION", category: "STRATEGIC", stage: "TERM_SHEET" }],
    ["zeta", { name: "Zeta Angels Club (demo)", type: "ORGANIZATION", category: "ANGEL", stage: "DROPPED" }],
    ["kappa", { name: "Kappa Seed Fund (demo)", type: "ORGANIZATION", category: "VC", isForeign: true, country: "SG", stage: "COMMITTED" }],
    ["huy", { name: "Vũ Đức Huy", type: "INDIVIDUAL", category: "EMPLOYEE" }],
    ["linh", { name: "Đỗ Mai Linh", type: "INDIVIDUAL", category: "EMPLOYEE" }],
    ["nam", { name: "Bùi Thanh Nam", type: "INDIVIDUAL", category: "EMPLOYEE" }],
  ];
  const I: Record<string, string> = {};
  let n = 0;
  for (const [key, data] of list) {
    n += 1;
    const owner = data.category === "VC" || data.category === "STRATEGIC" ? U.irLead : U.irStaff;
    const inv = await db.investor.create({
      data: { ...data, code: `INV-${String(n).padStart(4, "0")}`, irOwner: { connect: { id: owner } } },
    });
    I[key] = inv.id;
    await db.stageChange.create({ data: { investorId: inv.id, to: inv.stage, byId: U.irLead, note: "Dữ liệu mẫu" } });
  }

  // KYC mẫu — mã hoá giống hệt luồng thật
  for (const [key, idNo, bank] of [
    ["an", "001080000001", "VCB 0011000000001"],
    ["alpha", "UEN 201900001X", "DBS 000-000001-1"],
    ["gamma", "ĐKKD 0100000000", "BIDV 12010000000001"],
  ] as const) {
    await db.investor.update({
      where: { id: I[key] },
      data: {
        idNumberEnc: encryptField(idNo, `investor:${I[key]}:idNumber`),
        bankAccountEnc: encryptField(bank, `investor:${I[key]}:bankAccount`),
      },
    });
  }

  await db.investorContact.createMany({
    data: [
      { investorId: I.alpha, name: "Sarah Lim (demo)", title: "Partner", email: "sarah@alphaventures-demo.com", isPrimary: true },
      { investorId: I.delta, name: "Kim Joon (demo)", title: "Investment Director", email: "joon@deltagrowth-demo.com", isPrimary: true },
      { investorId: I.beta, name: "Tanaka Ken (demo)", title: "Principal", email: "ken@betacap-demo.jp" },
    ],
  });
  await db.interaction.createMany({
    data: [
      { investorId: I.delta, userId: U.ceo, date: D("2026-09-12"), kind: "MEETING", summary: "Họp giới thiệu Series B. Delta yêu cầu BCTC kiểm toán 3 năm và dữ liệu cohort người dùng." },
      { investorId: I.delta, userId: U.irLead, date: D("2026-10-05"), kind: "EMAIL", summary: "Đã gửi NDA, Delta ký ngày 08/10. Mở thẩm định." },
      { investorId: I.omega, userId: U.cfo, date: D("2026-10-15"), kind: "CALL", summary: "Thống nhất khung Term Sheet: anti-dilution broad-based, 1 ghế quan sát HĐQT." },
      { investorId: I.alpha, userId: U.irLead, date: D("2026-07-30"), kind: "MEETING", summary: "Báo cáo quý II. Alpha quan tâm lộ trình IPO và kế hoạch exit một phần ở Series B." },
    ],
  });

  // ── Sổ cái: tạo DRAFT (Pháp chế) → ghi sổ (Kế toán), đúng maker–checker như luồng thật
  type T = Omit<Prisma.ShareTransactionUncheckedCreateInput, "createdById">;
  const ledger: T[] = [
    { kind: "ISSUE", date: D("2011-03-01"), shareClassId: cls.common.id, quantity: 4_000_000n, toInvestorId: I.an, roundId: round.found.id, pricePerShare: 10000, amount: 40_000_000_000, docRef: "Điều lệ 2011" },
    { kind: "ISSUE", date: D("2011-03-01"), shareClassId: cls.common.id, quantity: 2_500_000n, toInvestorId: I.binh, roundId: round.found.id, pricePerShare: 10000, amount: 25_000_000_000, docRef: "Điều lệ 2011" },
    { kind: "ISSUE", date: D("2011-03-01"), shareClassId: cls.common.id, quantity: 1_500_000n, toInvestorId: I.cuong, roundId: round.found.id, pricePerShare: 10000, amount: 15_000_000_000, docRef: "Điều lệ 2011" },
    { kind: "ISSUE", date: D("2014-06-15"), shareClassId: cls.seed.id, quantity: 300_000n, toInvestorId: I.dung, roundId: round.seed.id, pricePerShare: 1.2, amount: 360_000, currency: "USD", docRef: "SSA-SEED-01" },
    { kind: "ISSUE", date: D("2014-06-15"), shareClassId: cls.seed.id, quantity: 200_000n, toInvestorId: I.ha, roundId: round.seed.id, pricePerShare: 1.2, amount: 240_000, currency: "USD", docRef: "SSA-SEED-02" },
    { kind: "ISSUE", date: D("2014-06-15"), shareClassId: cls.seed.id, quantity: 1_000_000n, toInvestorId: I.alpha, roundId: round.seed.id, pricePerShare: 1.2, amount: 1_200_000, currency: "USD", docRef: "SSA-SEED-03" },
    { kind: "ISSUE", date: D("2018-09-20"), shareClassId: cls.a.id, quantity: 1_500_000n, toInvestorId: I.beta, roundId: round.a.id, pricePerShare: 4.5, amount: 6_750_000, currency: "USD", docRef: "SSA-A-01" },
    { kind: "ISSUE", date: D("2018-09-20"), shareClassId: cls.a.id, quantity: 800_000n, toInvestorId: I.gamma, roundId: round.a.id, pricePerShare: 4.5, amount: 3_600_000, currency: "USD", docRef: "SSA-A-02" },
    { kind: "ISSUE", date: D("2018-09-20"), shareClassId: cls.a.id, quantity: 400_000n, toInvestorId: I.alpha, roundId: round.a.id, pricePerShare: 4.5, amount: 1_800_000, currency: "USD", docRef: "SSA-A-03" },
    { kind: "TRANSFER", date: D("2021-11-10"), shareClassId: cls.seed.id, quantity: 200_000n, fromInvestorId: I.ha, toInvestorId: I.gamma, pricePerShare: 3.8, amount: 760_000, currency: "USD", docRef: "SPA-2021-01", note: "Angel exit, đã có biên bản từ chối ROFR" },
    { kind: "REDEMPTION", date: D("2023-05-02"), shareClassId: cls.common.id, quantity: 100_000n, fromInvestorId: I.cuong, pricePerShare: 95000, amount: 9_500_000_000, docRef: "NQ-HĐQT-2023-07", note: "Công ty mua lại cổ phần" },
  ];
  for (const t of ledger) {
    const row = await db.shareTransaction.create({ data: { ...t, createdById: U.legal } });
    await db.shareTransaction.update({ where: { id: row.id }, data: { status: "POSTED", postedById: U.finance, postedAt: t.date as Date } });
  }

  // ── ESOP
  const pool = await db.esopPool.create({ data: { name: "ESOP 2020", shareClassId: cls.common.id, size: 1_000_000n, approvedAt: D("2020-04-20"), resolution: "NQ-ĐHĐCĐ-2020-02" } });
  const gHuy = await db.esopGrant.create({ data: { code: "ESOP-2020-001", poolId: pool.id, holderId: I.huy, grantDate: D("2020-06-01"), quantity: 120_000n, exercisePrice: 20000, vestingStart: D("2020-06-01") } });
  await db.esopGrant.create({ data: { code: "ESOP-2023-004", poolId: pool.id, holderId: I.linh, grantDate: D("2023-03-01"), quantity: 80_000n, exercisePrice: 35000, vestingStart: D("2023-03-01"), frequency: "QUARTERLY" } });
  await db.esopGrant.create({ data: { code: "ESOP-2022-002", poolId: pool.id, holderId: I.nam, grantDate: D("2022-01-10"), quantity: 60_000n, exercisePrice: 25000, vestingStart: D("2022-01-10"), status: "TERMINATED", terminatedAt: D("2024-07-10") } });
  const ex = await db.shareTransaction.create({
    data: { kind: "ISSUE", date: D("2025-02-01"), shareClassId: cls.common.id, quantity: 30_000n, toInvestorId: I.huy, esopGrantId: gHuy.id, pricePerShare: 20000, amount: 600_000_000, note: "Thực hiện quyền ESOP-2020-001", createdById: U.hr },
  });
  await db.shareTransaction.update({ where: { id: ex.id }, data: { status: "POSTED", postedById: U.finance, postedAt: D("2025-02-03") } });

  // ── SAFE chưa chuyển đổi
  await db.convertibleInstrument.create({
    data: { code: "SAFE-2025-01", investorId: I.kappa, kind: "SAFE_POST", principal: 500_000, currency: "USD", valuationCap: 40_000_000, discountPct: 20, issueDate: D("2025-11-01"), docRef: "SAFE-KAPPA-2025" },
  });

  // ── Một giao dịch nháp chờ Kế toán ghi sổ (để thử maker–checker)
  await db.shareTransaction.create({
    data: { kind: "TRANSFER", date: D("2026-10-20"), shareClassId: cls.seed.id, quantity: 50_000n, fromInvestorId: I.dung, toInvestorId: I.gamma, pricePerShare: 6.1, amount: 305_000, currency: "USD", docRef: "SPA-2026-03", note: "Chờ xác nhận thuế TNCN 0,1%", createdById: U.legal },
  });

  // Đồng bộ trạng thái vòng đời theo sổ cái
  for (const k of ["an", "binh", "alpha", "beta", "gamma", "dung", "huy"]) await db.investor.update({ where: { id: I[k] }, data: { stage: "SHAREHOLDER" } });
  await db.investor.update({ where: { id: I.cuong }, data: { stage: "PARTIAL_EXIT" } });
  await db.investor.update({ where: { id: I.ha }, data: { stage: "EXITED" } });

  // ── Tài khoản bên ngoài (OTP)
  await db.user.create({ data: { email: "auditor@kiemtoan-demo.vn", name: "Kiểm toán viên (demo)", kind: "EXTERNAL", role: "AUDITOR", accessExpires: inDays(90) } });
  await db.user.create({ data: { email: "sarah@alphaventures-demo.com", name: "Sarah Lim (demo)", kind: "EXTERNAL", role: "INVESTOR", investorId: I.alpha, accessExpires: inDays(365) } });
  await db.user.create({ data: { email: "joon@deltagrowth-demo.com", name: "Kim Joon (demo)", kind: "EXTERNAL", role: "PROSPECT", investorId: I.delta, accessExpires: inDays(30) } });

  await db.appSetting.create({ data: { key: "major_shareholder_pct", value: 5 } });
  await audit({ action: "seed.demo", data: { investors: list.length, transactions: ledger.length + 2 } }, undefined);
  console.log("✔ Đã nạp dữ liệu mẫu.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
