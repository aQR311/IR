import { describe, expect, it } from "vitest";
import { parseBool, parseCsv, parseDate, parseMoney, parseShares, slug, toRecords } from "./csv";

describe("parseCsv", () => {
  it("BOM, ngoặc kép, dấu phẩy trong ô, CRLF", () => {
    const rows = parseCsv('﻿Tên,Ghi chú\r\n"Công ty A, chi nhánh 1","Nói ""xin chào"""\r\nB,\r\n');
    expect(rows).toEqual([["Tên", "Ghi chú"], ["Công ty A, chi nhánh 1", 'Nói "xin chào"'], ["B", ""]]);
  });
  it("tự nhận dấu chấm phẩy (Excel locale VN)", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("bỏ dòng trống, chuẩn hoá tiêu đề", () => {
    const recs = toRecords(parseCsv("Tên NĐT,Số cổ phần\n\nAn,100\n,\n"));
    expect(recs).toEqual([{ line: 2, data: { ten_ndt: "An", so_co_phan: "100" } }]);
  });
  it("slug tiếng Việt", () => {
    expect(slug("Bên chuyển")).toBe("ben_chuyen");
    expect(slug("Đã exit")).toBe("da_exit");
  });
});

describe("chuẩn hoá giá trị", () => {
  it("số cổ phần", () => {
    expect(parseShares("1.000.000")).toBe(1_000_000n);
    expect(parseShares("1,000,000")).toBe(1_000_000n);
    expect(parseShares("0")).toBeNull();
    expect(parseShares("12.5x")).toBeNull();
  });
  it("tiền kiểu VN / US / thường", () => {
    expect(parseMoney("1.234.567,5")).toBe("1234567.5");
    expect(parseMoney("1,234,567.50")).toBe("1234567.50");
    expect(parseMoney("4,5")).toBe("4.5");
    expect(parseMoney("4.5")).toBe("4.5");
    expect(parseMoney("abc")).toBeNull();
  });
  it("ngày", () => {
    expect(parseDate("2024-03-15")?.toISOString()).toBe("2024-03-15T00:00:00.000Z");
    expect(parseDate("15/03/2024")?.toISOString()).toBe("2024-03-15T00:00:00.000Z");
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate("03-15-2024")).toBeNull();
  });
  it("có / không", () => {
    expect(parseBool("Có")).toBe(true);
    expect(parseBool("x")).toBe(true);
    expect(parseBool("Không")).toBe(false);
  });
});
