import "server-only";
import type { InvestorCategory, InvestorStage, InvestorType, TxnKind } from "@prisma/client";
import { db } from "@/lib/db";
import type { PreviewRow } from "@/lib/action";
import { computeHoldings, type LedgerRow } from "@/lib/cap-math";
import { parseBool, parseCsv, parseDate, parseMoney, parseShares, slug, toRecords } from "@/lib/csv";
import { postedLedger } from "./captable";

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;


/** Giá trị trong file → enum. Chấp nhận tiếng Việt có / không dấu và mã tiếng Anh. */
const TYPE: Record<string, InvestorType> = { ca_nhan: "INDIVIDUAL", individual: "INDIVIDUAL", to_chuc: "ORGANIZATION", organization: "ORGANIZATION", phap_nhan: "ORGANIZATION" };
const CATEGORY: Record<string, InvestorCategory> = {
  sang_lap: "FOUNDER", founder: "FOUNDER", vc: "VC", quy_vc: "VC", quy: "VC", chien_luoc: "STRATEGIC", strategic: "STRATEGIC",
  angel: "ANGEL", nhan_vien: "EMPLOYEE", employee: "EMPLOYEE", khac: "OTHER", other: "OTHER",
};
const STAGE: Record<string, InvestorStage> = {
  tiem_nang: "LEAD", lead: "LEAD", da_tiep_xuc: "CONTACTED", contacted: "CONTACTED", nda: "NDA", da_ky_nda: "NDA",
  dang_tham_dinh: "DUE_DILIGENCE", due_diligence: "DUE_DILIGENCE", term_sheet: "TERM_SHEET", da_cam_ket: "COMMITTED",
  committed: "COMMITTED", dung: "DROPPED", dropped: "DROPPED",
};
const KIND: Record<string, TxnKind> = {
  phat_hanh: "ISSUE", issue: "ISSUE", chuyen_nhuong: "TRANSFER", transfer: "TRANSFER",
  mua_lai: "REDEMPTION", huy: "REDEMPTION", redemption: "REDEMPTION",
};
const CURRENCIES = new Set(["VND", "USD", "SGD", "JPY", "KRW", "EUR"]);

type Rec = { line: number; data: Record<string, string> };

export function readCsv(bytes: Buffer): { error: string } | { recs: Rec[] } {
  if (bytes.length > MAX_IMPORT_BYTES) return { error: "File vượt quá 1MB." };
  const text = bytes.toString("utf8");
  if (text.includes("�")) return { error: "File không phải UTF-8. Trong Excel chọn Lưu thành → CSV UTF-8." };
  const recs = toRecords(parseCsv(text));
  if (recs.length === 0) return { error: "File không có dữ liệu." };
  if (recs.length > MAX_IMPORT_ROWS) return { error: `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần.` };
  return { recs };
}

// ───────────── Nhà đầu tư

export type InvestorDraft = {
  name: string; type: InvestorType; category: InvestorCategory; stage: InvestorStage; isForeign: boolean;
  country: string; email?: string; phone?: string; taxCode?: string; address?: string; notes?: string;
};

export async function validateInvestors(recs: { line: number; data: Record<string, string> }[]) {
  const existing = new Set((await db.investor.findMany({ select: { name: true } })).map((i) => slug(i.name)));
  const seen = new Set<string>();
  const rows: PreviewRow[] = [];
  const valid: InvestorDraft[] = [];
  for (const { line, data: d } of recs) {
    const name = d.ten ?? d.ten_nha_dau_tu ?? "";
    const errs: string[] = [];
    const type = TYPE[slug(d.loai ?? "")];
    const category = CATEGORY[slug(d.nhom ?? "")];
    const stage = d.trang_thai ? STAGE[slug(d.trang_thai)] : "LEAD";
    const country = (d.quoc_gia || "VN").toUpperCase();
    if (name.length < 2) errs.push("thiếu tên");
    if (!type) errs.push("loai phải là CA_NHAN hoặc TO_CHUC");
    if (!category) errs.push("nhom không hợp lệ");
    if (!stage) errs.push("trang_thai không hợp lệ (cổ đông / exit do sổ cái tự xác định)");
    if (!/^[A-Z]{2}$/.test(country)) errs.push("quoc_gia phải là mã 2 chữ");
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errs.push("email sai");
    const key = slug(name);
    if (existing.has(key)) errs.push("đã có nhà đầu tư trùng tên");
    if (seen.has(key)) errs.push("trùng tên với dòng khác trong file");
    seen.add(key);
    rows.push({ line, label: name || "(trống)", detail: [d.loai, d.nhom, country].filter(Boolean).join(" · "), error: errs.join("; ") || undefined });
    if (errs.length === 0) {
      valid.push({
        name, type, category, stage, country, isForeign: d.nuoc_ngoai ? parseBool(d.nuoc_ngoai) : country !== "VN",
        email: d.email || undefined, phone: d.dien_thoai || undefined, taxCode: d.ma_so_thue || undefined,
        address: d.dia_chi || undefined, notes: d.ghi_chu || undefined,
      });
    }
  }
  return { rows, valid, errors: rows.filter((r) => r.error).length };
}

// ───────────── Giao dịch cổ phần

export type TxnDraft = {
  date: Date; kind: TxnKind; shareClassId: string; quantity: bigint; fromInvestorId: string | null; toInvestorId: string | null;
  roundId: string | null; pricePerShare?: string; amount?: string; currency: string; docRef?: string; note?: string;
};

export async function validateTxns(recs: { line: number; data: Record<string, string> }[]) {
  const [investors, classes, rounds, ledger] = await Promise.all([
    db.investor.findMany({ select: { id: true, code: true, name: true } }),
    db.shareClass.findMany({ select: { id: true, code: true } }),
    db.fundingRound.findMany({ select: { id: true, code: true } }),
    postedLedger(),
  ]);
  // Tìm NĐT theo mã (INV-0001) hoặc tên chính xác (không phân biệt dấu / hoa thường).
  const byKey = new Map<string, { id: string; name: string }>();
  const dupNames = new Set<string>();
  for (const i of investors) {
    byKey.set(i.code.toUpperCase(), i);
    const k = slug(i.name);
    if (byKey.has(k)) dupNames.add(k);
    byKey.set(k, i);
  }
  const findInv = (v: string): { id: string | null } | { error: string } => {
    if (!v) return { id: null };
    const k = /^INV-\d+$/i.test(v) ? v.toUpperCase() : slug(v);
    if (dupNames.has(k)) return { error: `"${v}" trùng tên nhiều NĐT — dùng mã INV-xxxx` };
    const hit = byKey.get(k);
    return hit ? { id: hit.id } : { error: `không tìm thấy NĐT "${v}"` };
  };
  const classByCode = new Map(classes.map((c) => [c.code.toUpperCase(), c.id]));
  const roundByCode = new Map(rounds.map((r) => [r.code.toUpperCase(), r.id]));

  const rows: PreviewRow[] = [];
  const parsed: (TxnDraft & { line: number })[] = [];
  for (const { line, data: d } of recs) {
    const errs: string[] = [];
    const date = parseDate(d.ngay ?? "");
    const kind = KIND[slug(d.loai_gd ?? "")];
    const shareClassId = classByCode.get((d.lop_co_phan ?? "").toUpperCase());
    const quantity = parseShares(d.so_co_phan ?? "");
    const from = findInv(d.ben_chuyen ?? "");
    const to = findInv(d.ben_nhan ?? "");
    const roundId = d.vong ? roundByCode.get(d.vong.toUpperCase()) : null;
    const price = d.gia_cp ? parseMoney(d.gia_cp) : undefined;
    const amount = d.so_tien ? parseMoney(d.so_tien) : undefined;
    const currency = (d.tien_te || "VND").toUpperCase();

    if (!date) errs.push("ngay sai (YYYY-MM-DD hoặc DD/MM/YYYY)");
    if (!kind) errs.push("loai_gd phải là PHAT_HANH / CHUYEN_NHUONG / MUA_LAI");
    if (!shareClassId) errs.push(`không có lớp cổ phần "${d.lop_co_phan ?? ""}"`);
    if (!quantity) errs.push("so_co_phan phải là số nguyên > 0");
    if ("error" in from) errs.push(`bên chuyển: ${from.error}`);
    if ("error" in to) errs.push(`bên nhận: ${to.error}`);
    if (d.vong && !roundId) errs.push(`không có vòng "${d.vong}"`);
    if (price === null) errs.push("gia_cp không hợp lệ");
    if (amount === null) errs.push("so_tien không hợp lệ");
    if (!CURRENCIES.has(currency)) errs.push("tien_te không hỗ trợ");
    const fromId = "id" in from ? from.id : null;
    const toId = "id" in to ? to.id : null;
    if (kind === "ISSUE" && (!toId || fromId)) errs.push("phát hành: cần bên nhận, bỏ trống bên chuyển");
    if (kind === "TRANSFER" && (!toId || !fromId || toId === fromId)) errs.push("chuyển nhượng: cần 2 bên khác nhau");
    if (kind === "REDEMPTION" && (!fromId || toId)) errs.push("mua lại: cần bên chuyển, bỏ trống bên nhận");

    const label = [d.loai_gd, d.so_co_phan, d.lop_co_phan].filter(Boolean).join(" ");
    const detail = [d.ngay, [d.ben_chuyen || "Công ty", d.ben_nhan || "Công ty"].join(" → ")].join(" · ");
    rows.push({ line, label, detail, error: errs.join("; ") || undefined });
    if (errs.length === 0) {
      parsed.push({
        line, date: date!, kind: kind!, shareClassId: shareClassId!, quantity: quantity!, fromInvestorId: fromId, toInvestorId: toId,
        roundId: roundId ?? null, pricePerShare: price ?? undefined, amount: amount ?? undefined, currency,
        docRef: d.so_hd || undefined, note: d.ghi_chu || undefined,
      });
    }
  }

  // Áp toàn bộ file lên sổ hiện tại theo thứ tự ngày → phát hiện dòng nào làm âm cổ phần.
  const sorted = [...parsed].sort((a, b) => a.date.getTime() - b.date.getTime() || a.line - b.line);
  if (rows.every((r) => !r.error)) {
    const base = ledger.length ? Math.max(...ledger.map((l) => l.seq)) : 0;
    const sim: LedgerRow[] = [...ledger];
    for (const [i, t] of sorted.entries()) {
      sim.push({ seq: base + i + 1, kind: t.kind, shareClassId: t.shareClassId, quantity: t.quantity, fromInvestorId: t.fromInvestorId, toInvestorId: t.toInvestorId });
      try {
        computeHoldings(sim);
      } catch {
        const r = rows.find((x) => x.line === t.line)!;
        r.error = "bên chuyển không đủ cổ phần tại thời điểm này (xét theo thứ tự ngày)";
        break;
      }
    }
  }
  return { rows, valid: sorted, errors: rows.filter((r) => r.error).length };
}
