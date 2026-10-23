// Dữ liệu demo HƯ CẤU (mọi tên người, quỹ, email đều không có thật). Chạy: npm run db:seed
// hoặc db:reset-local để làm lại từ đầu. Từ chối chạy ở production hoặc trên DB không phải máy local.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient, type InvestorStage, type Prisma } from "@prisma/client";
import { encryptField, sha256Hex } from "../src/lib/crypto";
import { audit } from "../src/lib/audit";
import { computeHoldings, holderTotal } from "../src/lib/cap-math";
import { putObject } from "../src/lib/storage";

const db = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const inDays = (n: number) => new Date(Date.now() + n * 86400_000);

function guard() {
  const url = process.env.DATABASE_URL ?? "";
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  if (process.env.NODE_ENV === "production" || (!local && process.env.ALLOW_DEMO_SEED !== "true")) {
    throw new Error("Seed demo chỉ chạy trên DB local (hoặc đặt ALLOW_DEMO_SEED=true cho môi trường thử nghiệm).");
  }
}

/** PDF tối giản hợp lệ (chữ ASCII) — đủ để demo luồng tải tài liệu mã hoá. */
function makePdf(title: string, lines: string[]): Buffer {
  const ascii = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D")).replace(/[()\\]/g, "");
  const text = [ascii(title), "", ...lines.map(ascii), "", "TAI LIEU DEMO - DU LIEU HU CAU"]
    .map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${770 - i * 20} Td (${l}) Tj ET`)
    .join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function main() {
  guard();
  if ((await db.investor.count()) > 0) {
    console.log("DB đã có dữ liệu — bỏ qua. Dùng `npm run db:reset-local` để làm lại từ đầu.");
    return;
  }

  // ── Tài khoản nội bộ (demo)
  const userDefs = {
    it: ["it.admin@appota.com", "Quản trị IT (demo)", "SYS_ADMIN"],
    ceo: ["ceo.demo@appota.com", "CEO (demo)", "EXEC"],
    cfo: ["cfo.demo@appota.com", "CFO (demo)", "EXEC"],
    irLead: ["ir.lead@appota.com", "Trưởng IR (demo)", "IR_LEAD"],
    irStaff: ["ir.staff@appota.com", "Chuyên viên IR (demo)", "IR_STAFF"],
    legal: ["legal@appota.com", "Pháp chế (demo)", "LEGAL"],
    finance: ["finance@appota.com", "Kế toán (demo)", "FINANCE"],
    hr: ["hr.esop@appota.com", "C&B ESOP (demo)", "HR_ESOP"],
  } as const;
  const U = {} as Record<keyof typeof userDefs, string>;
  for (const [k, [email, name, role]] of Object.entries(userDefs) as [keyof typeof userDefs, readonly [string, string, string]][]) {
    U[k] = (await db.user.create({ data: { email, name, role: role as never, kind: "INTERNAL", lastLoginAt: inDays(-Math.floor(Math.random() * 5)) } })).id;
  }

  // ── Lớp cổ phần & vòng vốn
  const C = {
    pt: await db.shareClass.create({ data: { code: "CP_PT", name: "Cổ phần phổ thông", kind: "COMMON" } }),
    seed: await db.shareClass.create({ data: { code: "UD_SEED", name: "Cổ phần ưu đãi Seed", kind: "PREFERRED", liquidationPrefX: 1, seniority: 1, notes: "Ưu tiên thanh lý 1x, không tham gia" } }),
    a: await db.shareClass.create({ data: { code: "UD_A", name: "Cổ phần ưu đãi Series A", kind: "PREFERRED", liquidationPrefX: 1, seniority: 2, notes: "1x, chống pha loãng broad-based weighted average" } }),
    b: await db.shareClass.create({ data: { code: "UD_B", name: "Cổ phần ưu đãi Series B", kind: "PREFERRED", liquidationPrefX: 1, seniority: 3, notes: "1x, 1 ghế HĐQT cho nhà đầu tư dẫn dắt" } }),
  };
  const R = {
    found: await db.fundingRound.create({ data: { code: "FOUNDING", name: "Góp vốn thành lập", status: "CLOSED", closeDate: D("2011-03-01"), pricePerShare: 10000 } }),
    pre: await db.fundingRound.create({ data: { code: "PRESEED_2013", name: "Vòng Pre-seed", status: "CLOSED", closeDate: D("2013-05-20"), pricePerShare: 25000 } }),
    seed: await db.fundingRound.create({ data: { code: "SEED_2014", name: "Vòng Seed", status: "CLOSED", closeDate: D("2014-06-15"), currency: "USD", preMoney: 3_000_000, pricePerShare: 1.2 } }),
    a: await db.fundingRound.create({ data: { code: "SERIES_A_2016", name: "Vòng Series A", status: "CLOSED", closeDate: D("2016-09-20"), currency: "USD", preMoney: 18_000_000, pricePerShare: 4.5 } }),
    b: await db.fundingRound.create({ data: { code: "SERIES_B_2019", name: "Vòng Series B", status: "CLOSED", closeDate: D("2019-11-05"), currency: "USD", preMoney: 62_000_000, pricePerShare: 9.8 } }),
    c: await db.fundingRound.create({ data: { code: "SERIES_C_2027", name: "Vòng Series C", status: "OPEN", currency: "USD", targetAmount: 25_000_000, notes: "Mục tiêu đóng vòng Q2/2027" } }),
  };

  // ── Nhà đầu tư (hư cấu)
  type Inv = Omit<Prisma.InvestorCreateInput, "code">;
  const org = (name: string, category: Inv["category"], country = "VN", extra: Partial<Inv> = {}): Inv => ({
    name, type: "ORGANIZATION", category, country, isForeign: country !== "VN", ...extra,
  });
  const person = (name: string, category: Inv["category"], extra: Partial<Inv> = {}): Inv => ({ name, type: "INDIVIDUAL", category, ...extra });
  const defs: [string, Inv][] = [
    ["an", person("Nguyễn Văn An", "FOUNDER", { kycStatus: "VERIFIED", email: "an.nguyen@example.vn" })],
    ["binh", person("Trần Thị Bình", "FOUNDER", { kycStatus: "VERIFIED" })],
    ["cuong", person("Lê Minh Cường", "FOUNDER", { kycStatus: "VERIFIED" })],
    ["long", person("Đặng Hoàng Long", "FOUNDER", { kycStatus: "VERIFIED" })],
    ["dung", person("Phạm Quốc Dũng", "ANGEL", { kycStatus: "PENDING" })],
    ["ha", person("Hoàng Thu Hà", "ANGEL", { kycStatus: "VERIFIED" })],
    ["khoa", person("Phan Minh Khoa", "ANGEL", { kycStatus: "VERIFIED" })],
    ["mai", person("Trịnh Ngọc Mai", "ANGEL", { kycStatus: "VERIFIED" })],
    ["bao", person("Lý Gia Bảo", "ANGEL", { kycStatus: "NOT_STARTED" })],
    ["alpha", org("Alpha Ventures Fund I (demo)", "VC", "SG", { kycStatus: "VERIFIED", email: "ir@alphaventures-demo.com" })],
    ["sakura", org("Sakura Angels Fund (demo)", "VC", "JP", { kycStatus: "VERIFIED" })],
    ["mekong", org("Mekong Seed Partners (demo)", "VC", "VN", { kycStatus: "VERIFIED" })],
    ["beta", org("Beta Capital Partners (demo)", "VC", "JP", { kycStatus: "PENDING" })],
    ["gamma", org("Công ty CP Gamma Media (demo)", "STRATEGIC", "VN", { kycStatus: "VERIFIED", taxCode: "0100000000" })],
    ["orion", org("Orion Growth Fund (demo)", "VC", "US", { kycStatus: "VERIFIED" })],
    ["nova", org("Nova Strategic Holdings (demo)", "STRATEGIC", "KR", { kycStatus: "VERIFIED" })],
    ["lumen", org("Lumen Capital Asia (demo)", "VC", "SG", { kycStatus: "VERIFIED" })],
    ["kappa", org("Kappa Seed Fund (demo)", "VC", "SG", { stage: "COMMITTED", kycStatus: "VERIFIED" })],
    ["helix", org("Helix Ventures (demo)", "VC", "HK", { stage: "COMMITTED", kycStatus: "PENDING" })],
    ["delta", org("Delta Growth Fund (demo)", "VC", "KR", { stage: "DUE_DILIGENCE" })],
    ["omega", org("Omega Holdings (demo)", "STRATEGIC", "VN", { stage: "TERM_SHEET" })],
    ["aurora", org("Aurora Tech Partners (demo)", "VC", "US", { stage: "COMMITTED" })],
    ["polaris", org("Polaris Asia Fund (demo)", "VC", "SG", { stage: "NDA" })],
    ["zenith", org("Zenith Family Office (demo)", "OTHER", "VN", { stage: "CONTACTED" })],
    ["titan", org("Titan Digital Group (demo)", "STRATEGIC", "TH", { stage: "CONTACTED" })],
    ["epsilon", org("Epsilon Partners (demo)", "VC", "US", { stage: "LEAD" })],
    ["vega", org("Vega Impact Fund (demo)", "VC", "ID", { stage: "LEAD" })],
    ["orca", org("Orca Ventures (demo)", "VC", "MY", { stage: "LEAD" })],
    ["zeta", org("Zeta Angels Club (demo)", "ANGEL", "VN", { stage: "DROPPED" })],
    ["sirius", org("Sirius Capital (demo)", "VC", "US", { stage: "DROPPED" })],
    // Nhân sự nhận ESOP
    ["huy", person("Vũ Đức Huy", "EMPLOYEE")],
    ["linh", person("Đỗ Mai Linh", "EMPLOYEE")],
    ["nam", person("Bùi Thanh Nam", "EMPLOYEE")],
    ["phuong", person("Ngô Thị Phương", "EMPLOYEE")],
    ["tuan", person("Hồ Anh Tuấn", "EMPLOYEE")],
    ["hang", person("Đinh Thu Hằng", "EMPLOYEE")],
    ["quan", person("Lâm Minh Quân", "EMPLOYEE")],
    ["thao", person("Mạc Phương Thảo", "EMPLOYEE")],
    ["khanh", person("Tạ Quốc Khánh", "EMPLOYEE")],
    ["vy", person("Cao Tường Vy", "EMPLOYEE")],
    ["duc", person("Kiều Minh Đức", "EMPLOYEE")],
    ["ngan", person("Lương Bảo Ngân", "EMPLOYEE")],
    ["son", person("Quách Văn Sơn", "EMPLOYEE")],
    ["lan", person("Âu Ngọc Lan", "EMPLOYEE")],
  ];
  const I = {} as Record<string, string>;
  for (const [n, [key, data]] of defs.entries()) {
    const owner = data.category === "VC" || data.category === "STRATEGIC" ? U.irLead : data.category === "EMPLOYEE" ? null : U.irStaff;
    const inv = await db.investor.create({
      data: { ...data, code: `INV-${String(n + 1).padStart(4, "0")}`, ...(owner ? { irOwner: { connect: { id: owner } } } : {}) },
    });
    I[key] = inv.id;
  }

  // Lịch sử vòng đời cho nhà đầu tư tiềm năng (có ngày thật để dòng thời gian trông như thật)
  const journeys: [string, [InvestorStage, string][]][] = [
    ["delta", [["LEAD", "2026-06-02"], ["CONTACTED", "2026-07-15"], ["NDA", "2026-09-08"], ["DUE_DILIGENCE", "2026-10-05"]]],
    ["omega", [["LEAD", "2026-04-10"], ["CONTACTED", "2026-05-20"], ["NDA", "2026-06-30"], ["DUE_DILIGENCE", "2026-08-12"], ["TERM_SHEET", "2026-10-15"]]],
    ["aurora", [["LEAD", "2026-03-01"], ["CONTACTED", "2026-03-25"], ["NDA", "2026-05-02"], ["DUE_DILIGENCE", "2026-06-10"], ["TERM_SHEET", "2026-08-01"], ["COMMITTED", "2026-09-29"]]],
    ["polaris", [["LEAD", "2026-08-01"], ["CONTACTED", "2026-09-03"], ["NDA", "2026-10-12"]]],
    ["zenith", [["LEAD", "2026-09-10"], ["CONTACTED", "2026-10-02"]]],
    ["titan", [["LEAD", "2026-09-18"], ["CONTACTED", "2026-10-09"]]],
    ["zeta", [["LEAD", "2025-11-01"], ["CONTACTED", "2025-12-10"], ["DROPPED", "2026-02-15"]]],
    ["sirius", [["LEAD", "2026-01-12"], ["CONTACTED", "2026-02-20"], ["NDA", "2026-03-30"], ["DROPPED", "2026-06-01"]]],
    ["kappa", [["LEAD", "2025-07-01"], ["TERM_SHEET", "2025-09-20"], ["COMMITTED", "2025-11-01"]]],
    ["helix", [["LEAD", "2025-12-05"], ["TERM_SHEET", "2026-02-10"], ["COMMITTED", "2026-03-15"]]],
  ];
  for (const [key, steps] of journeys) {
    let from: InvestorStage | null = null;
    for (const [to, at] of steps) {
      await db.stageChange.create({ data: { investorId: I[key], from, to, at: D(at), byId: U.irLead } });
      from = to;
    }
  }
  for (const k of ["epsilon", "vega", "orca"]) {
    await db.stageChange.create({ data: { investorId: I[k], to: "LEAD", at: D("2026-10-01"), byId: U.irStaff, note: "Danh sách theo dõi Series C" } });
  }

  // ── Sổ cái: tạo DRAFT (Pháp chế) → ghi sổ (Kế toán), đúng maker–checker
  type T = Omit<Prisma.ShareTransactionUncheckedCreateInput, "createdById"> & { by?: string };
  const usd = (q: number, p: number) => ({ pricePerShare: p, amount: Math.round(q * p * 100) / 100, currency: "USD" });
  const vnd = (q: number, p: number) => ({ pricePerShare: p, amount: q * p, currency: "VND" });
  const issue = (date: string, cls: string, q: number, to: string, round: string | null, money: object, docRef: string): T => ({
    kind: "ISSUE", date: D(date), shareClassId: cls, quantity: BigInt(q), toInvestorId: I[to], roundId: round, docRef, ...money,
  });
  const ledger: T[] = [
    issue("2011-03-01", C.pt.id, 4_000_000, "an", R.found.id, vnd(4_000_000, 10000), "Điều lệ 2011"),
    issue("2011-03-01", C.pt.id, 2_500_000, "binh", R.found.id, vnd(2_500_000, 10000), "Điều lệ 2011"),
    issue("2011-03-01", C.pt.id, 1_500_000, "cuong", R.found.id, vnd(1_500_000, 10000), "Điều lệ 2011"),
    issue("2012-08-15", C.pt.id, 500_000, "long", null, vnd(500_000, 10000), "NQ-ĐHĐCĐ-2012-03"),
    ...([["dung", 300_000], ["ha", 200_000], ["khoa", 150_000], ["mai", 100_000], ["bao", 120_000]] as const).map(([k, q], i) =>
      issue("2013-05-20", C.pt.id, q, k, R.pre.id, vnd(q, 25000), `SSA-PRE-0${i + 1}`)),
    issue("2014-06-15", C.seed.id, 1_000_000, "alpha", R.seed.id, usd(1_000_000, 1.2), "SSA-SEED-01"),
    issue("2014-06-15", C.seed.id, 300_000, "sakura", R.seed.id, usd(300_000, 1.2), "SSA-SEED-02"),
    issue("2014-06-15", C.seed.id, 400_000, "mekong", R.seed.id, usd(400_000, 1.2), "SSA-SEED-03"),
    issue("2016-09-20", C.a.id, 1_500_000, "beta", R.a.id, usd(1_500_000, 4.5), "SSA-A-01"),
    issue("2016-09-20", C.a.id, 800_000, "gamma", R.a.id, usd(800_000, 4.5), "SSA-A-02"),
    issue("2016-09-20", C.a.id, 400_000, "alpha", R.a.id, usd(400_000, 4.5), "SSA-A-03"),
    issue("2016-09-20", C.a.id, 600_000, "orion", R.a.id, usd(600_000, 4.5), "SSA-A-04"),
    issue("2019-11-05", C.b.id, 1_200_000, "nova", R.b.id, usd(1_200_000, 9.8), "SSA-B-01"),
    issue("2019-11-05", C.b.id, 900_000, "lumen", R.b.id, usd(900_000, 9.8), "SSA-B-02"),
    issue("2019-11-05", C.b.id, 300_000, "beta", R.b.id, usd(300_000, 9.8), "SSA-B-03"),
    issue("2019-11-05", C.b.id, 200_000, "gamma", R.b.id, usd(200_000, 9.8), "SSA-B-04"),
    { kind: "TRANSFER", date: D("2021-11-10"), shareClassId: C.pt.id, quantity: 200_000n, fromInvestorId: I.ha, toInvestorId: I.gamma, ...usd(200_000, 6.2), docRef: "SPA-2021-01", note: "Angel exit, đã có biên bản từ chối ROFR" },
    { kind: "TRANSFER", date: D("2022-03-18"), shareClassId: C.pt.id, quantity: 100_000n, fromInvestorId: I.mai, toInvestorId: I.lumen, ...usd(100_000, 6.8), docRef: "SPA-2022-01", note: "Đã nộp thuế TNCN 0,1%" },
    { kind: "TRANSFER", date: D("2022-09-01"), shareClassId: C.seed.id, quantity: 300_000n, fromInvestorId: I.sakura, toInvestorId: I.orion, ...usd(300_000, 7.1), docRef: "SPA-2022-02", note: "Quỹ Sakura đóng quỹ, bán toàn bộ" },
    { kind: "REDEMPTION", date: D("2023-05-02"), shareClassId: C.pt.id, quantity: 100_000n, fromInvestorId: I.cuong, ...vnd(100_000, 160000), docRef: "NQ-HĐQT-2023-07", note: "Công ty mua lại cổ phần" },
    { kind: "TRANSFER", date: D("2024-07-15"), shareClassId: C.seed.id, quantity: 400_000n, fromInvestorId: I.alpha, toInvestorId: I.nova, ...usd(400_000, 8.9), docRef: "SPA-2024-01", note: "Alpha exit một phần trước khi đóng quỹ I" },
  ];
  const post = async (t: T, maker = U.legal, checker = U.finance) => {
    const row = await db.shareTransaction.create({ data: { ...t, createdById: maker } });
    await db.shareTransaction.update({ where: { id: row.id }, data: { status: "POSTED", postedById: checker, postedAt: t.date as Date } });
  };
  for (const t of ledger) await post(t);

  // ── ESOP: 2 đợt bể, 14 nhân sự
  const pool1 = await db.esopPool.create({ data: { name: "ESOP 2017", shareClassId: C.pt.id, size: 800_000n, approvedAt: D("2017-04-20"), resolution: "NQ-ĐHĐCĐ-2017-02" } });
  const pool2 = await db.esopPool.create({ data: { name: "Mở rộng ESOP 2022", shareClassId: C.pt.id, size: 700_000n, approvedAt: D("2022-05-10"), resolution: "NQ-ĐHĐCĐ-2022-04" } });
  type G = [string, string, number, number, string, ("MONTHLY" | "QUARTERLY")?, string?];
  const grants: G[] = [
    ["huy", "ESOP-2017-001", 120_000, 20000, "2017-06-01"],
    ["linh", "ESOP-2019-002", 80_000, 30000, "2019-03-01", "QUARTERLY"],
    ["nam", "ESOP-2018-003", 60_000, 25000, "2018-01-10", "MONTHLY", "2020-07-10"],
    ["phuong", "ESOP-2020-004", 100_000, 35000, "2020-02-01"],
    ["tuan", "ESOP-2020-005", 90_000, 35000, "2020-09-01"],
    ["hang", "ESOP-2021-006", 70_000, 40000, "2021-04-01", "MONTHLY", "2023-01-01"],
    ["quan", "ESOP-2021-007", 50_000, 40000, "2021-10-01"],
    ["thao", "ESOP-2022-008", 60_000, 50000, "2022-06-01"],
    ["khanh", "ESOP-2023-009", 60_000, 55000, "2023-01-15"],
    ["vy", "ESOP-2023-010", 40_000, 55000, "2023-08-01", "QUARTERLY"],
    ["duc", "ESOP-2024-011", 80_000, 60000, "2024-02-01"],
    ["ngan", "ESOP-2025-012", 30_000, 65000, "2025-01-10"],
    ["son", "ESOP-2025-013", 45_000, 65000, "2025-09-01"],
    ["lan", "ESOP-2026-014", 35_000, 70000, "2026-03-01"],
  ];
  const G = {} as Record<string, string>;
  for (const [k, code, q, price, start, freq, term] of grants) {
    const g = await db.esopGrant.create({
      data: {
        code, poolId: start < "2022-05-10" ? pool1.id : pool2.id, holderId: I[k], grantDate: D(start), quantity: BigInt(q),
        exercisePrice: price, vestingStart: D(start), frequency: freq ?? "MONTHLY",
        ...(term ? { status: "TERMINATED" as const, terminatedAt: D(term) } : {}), docRef: `TT-ESOP-${code.slice(-3)}`,
      },
    });
    G[k] = g.id;
  }
  const exercise = (k: string, q: number, date: string, price: number): T => ({
    kind: "ISSUE", date: D(date), shareClassId: C.pt.id, quantity: BigInt(q), toInvestorId: I[k], esopGrantId: G[k],
    ...vnd(q, price), note: "Thực hiện quyền ESOP",
  });
  for (const [k, q, date, price] of [["huy", 60_000, "2022-03-01", 20000], ["nam", 20_000, "2020-08-01", 25000], ["linh", 40_000, "2023-09-01", 30000], ["huy", 30_000, "2024-06-01", 20000], ["tuan", 45_000, "2025-03-01", 35000]] as const) {
    await post(exercise(k, q, date, price), U.hr, U.finance);
  }

  // ── Khoản đầu tư chuyển đổi chưa chuyển đổi
  await db.convertibleInstrument.create({ data: { code: "SAFE-2025-01", investorId: I.kappa, kind: "SAFE_POST", principal: 750_000, currency: "USD", valuationCap: 120_000_000, discountPct: 20, issueDate: D("2025-11-01"), docRef: "SAFE-KAPPA-2025" } });
  await db.convertibleInstrument.create({ data: { code: "CN-2026-01", investorId: I.helix, kind: "CONVERTIBLE_NOTE", principal: 1_500_000, currency: "USD", valuationCap: 140_000_000, discountPct: 15, interestPct: 6, issueDate: D("2026-03-15"), maturityDate: D("2028-03-15"), docRef: "CN-HELIX-2026" } });

  // ── Việc đang chờ (để thử maker–checker)
  await db.shareTransaction.create({ data: { kind: "TRANSFER", date: D("2026-10-20"), shareClassId: C.pt.id, quantity: 50_000n, fromInvestorId: I.dung, toInvestorId: I.nova, ...usd(50_000, 11.5), docRef: "SPA-2026-03", note: "Chờ xác nhận thuế TNCN 0,1%", createdById: U.legal } });
  await db.shareTransaction.create({ data: { ...exercise("phuong", 25_000, "2026-10-18", 35000), note: "Yêu cầu thực hiện quyền — chờ Kế toán xác nhận tiền về", createdById: U.hr } });

  // ── Trạng thái vòng đời theo sổ cái (giống luồng thật)
  const posted = await db.shareTransaction.findMany({ where: { status: "POSTED" }, select: { seq: true, kind: true, shareClassId: true, quantity: true, fromInvestorId: true, toInvestorId: true } });
  const h = computeHoldings(posted);
  for (const id of new Set(posted.flatMap((t) => [t.fromInvestorId, t.toInvestorId]).filter(Boolean) as string[])) {
    const now = holderTotal(h.get(id));
    const sold = posted.some((t) => t.fromInvestorId === id);
    const stage: InvestorStage = now > 0n ? (sold ? "PARTIAL_EXIT" : "SHAREHOLDER") : "EXITED";
    await db.investor.update({ where: { id }, data: { stage } });
    await db.stageChange.create({ data: { investorId: id, to: stage, byId: U.finance, note: "Tự động theo sổ cái" } });
  }

  // ── KYC (mã hoá giống luồng thật) & đầu mối
  const kyc: [string, string, string][] = [
    ["an", "001080000001", "VCB 0011000000001"], ["binh", "001185000002", "TCB 19030000000002"], ["long", "079082000003", "ACB 2010000003"],
    ["alpha", "UEN 201400001X", "DBS 000-000001-1"], ["gamma", "ĐKKD 0100000000", "BIDV 12010000000001"],
    ["nova", "BRN 110-81-00001", "Shinhan VN 700-000-000001"], ["lumen", "UEN 201800002K", "OCBC 501-000002-001"],
  ];
  for (const [k, idNo, bank] of kyc) {
    await db.investor.update({ where: { id: I[k] }, data: {
      idNumberEnc: encryptField(idNo, `investor:${I[k]}:idNumber`),
      bankAccountEnc: encryptField(bank, `investor:${I[k]}:bankAccount`),
    } });
  }
  await db.investorContact.createMany({ data: [
    { investorId: I.alpha, name: "Sarah Lim (demo)", title: "Partner", email: "sarah@alphaventures-demo.com", isPrimary: true },
    { investorId: I.beta, name: "Tanaka Ken (demo)", title: "Principal", email: "ken@betacap-demo.jp", isPrimary: true },
    { investorId: I.nova, name: "Park Ji-woo (demo)", title: "Head of Strategic Investment", email: "jiwoo@nova-demo.kr", isPrimary: true },
    { investorId: I.lumen, name: "Rahul Mehta (demo)", title: "Managing Director", email: "rahul@lumen-demo.sg", isPrimary: true },
    { investorId: I.orion, name: "Emily Carter (demo)", title: "Vice President", email: "emily@orion-demo.com", isPrimary: true },
    { investorId: I.gamma, name: "Nguyễn Hải Yến (demo)", title: "Giám đốc Đầu tư", email: "yen.nh@gamma-demo.vn", isPrimary: true },
    { investorId: I.delta, name: "Kim Joon (demo)", title: "Investment Director", email: "joon@deltagrowth-demo.com", isPrimary: true },
    { investorId: I.delta, name: "Lee Soo-min (demo)", title: "Analyst", email: "soomin@deltagrowth-demo.com" },
    { investorId: I.omega, name: "Trần Đức Mạnh (demo)", title: "Phó Tổng Giám đốc", email: "manh.td@omega-demo.vn", isPrimary: true },
    { investorId: I.aurora, name: "David Chen (demo)", title: "General Partner", email: "david@aurora-demo.com", isPrimary: true },
    { investorId: I.polaris, name: "Grace Tan (demo)", title: "Partner", email: "grace@polaris-demo.sg", isPrimary: true },
  ] });

  // ── Lịch sử tương tác
  const notes: [string, keyof typeof U, string, "MEETING" | "CALL" | "EMAIL" | "NOTE", string][] = [
    ["delta", "ceo", "2026-07-15", "MEETING", "Gặp lần đầu tại Seoul. Delta quan tâm mảng thanh toán & game publishing, muốn xem cohort người dùng 24 tháng."],
    ["delta", "irLead", "2026-09-08", "EMAIL", "Delta ký NDA. Đã mở thư mục thẩm định: pháp lý, BCTC kiểm toán 2023–2025, hợp đồng trọng yếu."],
    ["delta", "cfo", "2026-10-14", "CALL", "Delta hỏi về điều khoản ưu tiên thanh lý Series B và lộ trình IPO. Hẹn gửi phân tích waterfall."],
    ["omega", "ceo", "2026-08-12", "MEETING", "Omega muốn đầu tư chiến lược + hợp tác phân phối. Đề xuất 1 ghế HĐQT."],
    ["omega", "cfo", "2026-10-15", "CALL", "Thống nhất khung Term Sheet: $6M, pre-money $150M, anti-dilution broad-based, 1 ghế quan sát HĐQT."],
    ["aurora", "ceo", "2026-09-29", "MEETING", "Aurora cam kết $8M dẫn dắt Series C, điều kiện: hoàn tất kiểm toán Q3 và mở rộng ESOP lên 12%."],
    ["polaris", "irLead", "2026-10-12", "EMAIL", "Polaris ký NDA, xin lịch gặp ban điều hành tuần sau."],
    ["zenith", "irStaff", "2026-10-02", "CALL", "Family office quan tâm khoản nhỏ $1–2M ở vòng C. Cần gửi teaser deck."],
    ["titan", "ceo", "2026-10-09", "MEETING", "Titan (Thái Lan) muốn hợp tác mở rộng thị trường, đầu tư là phương án thứ hai."],
    ["alpha", "irLead", "2026-07-30", "MEETING", "Báo cáo quý II. Alpha quan tâm lộ trình IPO và khả năng bán thứ cấp phần còn lại ở Series C."],
    ["beta", "cfo", "2026-08-20", "EMAIL", "Gửi BCTC bán niên 2026. Beta đề nghị bổ sung KYC người đại diện mới."],
    ["nova", "ceo", "2026-09-05", "MEETING", "Họp HĐQT quý III. Nova đề xuất hợp tác thị trường Hàn Quốc; sẵn sàng mua thêm thứ cấp."],
    ["lumen", "irLead", "2026-06-18", "CALL", "Lumen hỏi kế hoạch chia cổ tức 2027 và tỷ lệ sử dụng vốn Series B."],
    ["gamma", "cfo", "2026-05-10", "MEETING", "Gamma đề nghị gia hạn hợp đồng hợp tác nội dung 3 năm; không có kế hoạch thoái vốn."],
    ["orion", "irLead", "2026-04-22", "EMAIL", "Orion yêu cầu bản cập nhật cap table pha loãng hoàn toàn cho báo cáo LP."],
    ["kappa", "cfo", "2025-11-01", "NOTE", "Nhận đủ $750K theo SAFE. Chuyển đổi tại vòng Series C theo cap $120M / chiết khấu 20%."],
    ["helix", "cfo", "2026-03-15", "NOTE", "Phát hành trái phiếu chuyển đổi $1.5M, lãi 6%/năm, đáo hạn 03/2028."],
    ["dung", "legal", "2026-10-20", "NOTE", "Ông Dũng chuyển nhượng 50.000 CP cho Nova. Chờ chứng từ nộp thuế TNCN."],
    ["sirius", "irLead", "2026-06-01", "EMAIL", "Sirius dừng vì thay đổi chiến lược quỹ, không đầu tư Đông Nam Á năm 2026."],
    ["zeta", "irStaff", "2026-02-15", "NOTE", "Zeta dừng: không đáp ứng mức tối thiểu $1M của vòng."],
  ];
  await db.interaction.createMany({ data: notes.map(([k, by, date, kind, summary]) => ({ investorId: I[k], userId: U[by], date: D(date), kind, summary })) });

  // ── Tài liệu mẫu (PDF thật, được mã hoá trước khi lưu như luồng thật)
  const docs: [string, string, "INTERNAL" | "CONFIDENTIAL" | "STRICT", string | null, string[]][] = [
    ["Điều lệ công ty (sửa đổi 2025)", "RESOLUTION", "INTERNAL", null, ["Von dieu le va co cau co phan", "Quyen va nghia vu co dong"]],
    ["Nghị quyết ĐHĐCĐ thường niên 2026", "RESOLUTION", "CONFIDENTIAL", null, ["Thong qua BCTC kiem toan 2025", "Mo rong bo ESOP them 3%"]],
    ["Báo cáo tài chính kiểm toán 2025", "FINANCIAL", "CONFIDENTIAL", null, ["Bao cao cua kiem toan doc lap", "Bang can doi ke toan 31/12/2025"]],
    ["Định giá nội bộ trước Series C", "FINANCIAL", "STRICT", null, ["Pre-money muc tieu: 150 trieu USD", "Chi danh cho Ban dieu hanh"]],
    ["Giấy chứng nhận cổ phần — Alpha Ventures", "CERTIFICATE", "CONFIDENTIAL", "alpha", ["So luong: 600.000 CP uu dai Seed", "400.000 CP uu dai Series A"]],
    ["Hợp đồng mua cổ phần Series A — Beta Capital", "CONTRACT", "CONFIDENTIAL", "beta", ["SSA-A-01", "1.500.000 CP uu dai Series A"]],
    ["Hợp đồng cổ đông (SHA) Series B", "CONTRACT", "CONFIDENTIAL", "nova", ["SHA-B-2019", "Quyen uu tien mua truoc, quyen cung ban"]],
    ["Biên bản họp thẩm định — Delta Growth", "OTHER", "CONFIDENTIAL", "delta", ["Danh muc tai lieu tham dinh da cung cap", "Cau hoi ve dieu khoan uu tien thanh ly"]],
  ];
  for (const [title, category, confidentiality, inv, lines] of docs) {
    const bytes = makePdf(title, lines);
    const key = `docs/demo/${randomUUID()}`;
    await putObject(key, bytes);
    await db.document.create({ data: {
      title, category, confidentiality, investorId: inv ? I[inv] : null, storageKey: key,
      fileName: `${title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`,
      mime: "application/pdf", size: bytes.length, sha256: sha256Hex(bytes), uploadedById: U.legal,
    } });
  }

  // ── Tài khoản bên ngoài (OTP)
  await db.user.create({ data: { email: "auditor@kiemtoan-demo.vn", name: "Kiểm toán viên (demo)", kind: "EXTERNAL", role: "AUDITOR", accessExpires: inDays(90) } });
  await db.user.create({ data: { email: "sarah@alphaventures-demo.com", name: "Sarah Lim (demo)", kind: "EXTERNAL", role: "INVESTOR", investorId: I.alpha, accessExpires: inDays(365) } });
  await db.user.create({ data: { email: "joon@deltagrowth-demo.com", name: "Kim Joon (demo)", kind: "EXTERNAL", role: "PROSPECT", investorId: I.delta, accessExpires: inDays(30) } });

  await db.appSetting.create({ data: { key: "major_shareholder_pct", value: 5 } });
  await audit({ action: "seed.demo", data: { investors: defs.length, transactions: ledger.length + 5, documents: docs.length } });
  console.log(`✔ Đã nạp dữ liệu demo: ${defs.length} nhà đầu tư, ${ledger.length + 7} giao dịch, ${grants.length} quyền ESOP, ${docs.length} tài liệu.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
