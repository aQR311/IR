// Đọc CSV xuất từ Excel (UTF-8, có / không BOM, dấu phẩy hoặc chấm phẩy) và chuẩn hoá dữ liệu kiểu Việt Nam.
// Thuần (không I/O) để test được.

/** Bỏ dấu tiếng Việt, chữ thường, khoảng trắng → "_". "Tên nhà đầu tư" → "ten_nha_dau_tu". */
export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** RFC 4180: hỗ trợ ô có ngoặc kép, dấu phân cách và xuống dòng bên trong ngoặc. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Dòng → object theo tiêu đề đã chuẩn hoá. Trả kèm số dòng gốc trong file (tính cả dòng tiêu đề). */
export function toRecords(rows: string[][]): { line: number; data: Record<string, string> }[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map(slug);
  return body.map((r, i) => ({
    line: i + 2,
    data: Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? "").trim()])),
  }));
}

/** Số cổ phần: "1.000.000", "1,000,000", "1 000 000" → 1000000n. */
export function parseShares(v: string): bigint | null {
  const s = v.replace(/[\s.,]/g, "");
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = BigInt(s);
  return n > 0n ? n : null;
}

/**
 * Tiền: chấp nhận "1.234.567,89" (kiểu VN), "1,234,567.89" (kiểu US) hoặc "1234567.89".
 * Trả chuỗi thập phân chuẩn để đưa vào Decimal; null nếu không hiểu được.
 */
export function parseMoney(v: string): string | null {
  const s = v.replace(/\s/g, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,6})?$/.test(s)) return s.replace(/\./g, "").replace(",", ".");
  if (/^\d{1,3}(,\d{3})+(\.\d{1,6})?$/.test(s)) return s.replace(/,/g, "");
  if (/^\d+,\d{1,6}$/.test(s)) return s.replace(",", ".");
  if (/^\d+(\.\d{1,6})?$/.test(s)) return s;
  return null;
}

/** Ngày: "2024-03-15" hoặc "15/03/2024" (kiểu VN, ngày trước). */
export function parseDate(v: string): Date | null {
  let y: number, m: number, d: number;
  let mt = v.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return date;
}

export function parseBool(v: string): boolean {
  return ["c", "co", "y", "yes", "x", "1", "true"].includes(slug(v));
}
