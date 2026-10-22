import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";

// File mẫu để điền trong Excel. Có BOM để Excel mở đúng tiếng Việt; lưu lại bằng "CSV UTF-8".
const TEMPLATES: Record<string, { file: string; rows: string[][] }> = {
  "nha-dau-tu": {
    file: "mau-nha-dau-tu.csv",
    rows: [
      ["ten", "loai", "nhom", "nuoc_ngoai", "quoc_gia", "email", "dien_thoai", "ma_so_thue", "dia_chi", "trang_thai", "ghi_chu"],
      ["Công ty CP Ví Dụ", "TO_CHUC", "CHIEN_LUOC", "", "VN", "ir@vidu.vn", "", "0100000000", "Hà Nội", "", "loai: CA_NHAN | TO_CHUC"],
      ["Example Fund LP", "TO_CHUC", "VC", "Có", "SG", "", "", "", "", "DANG_THAM_DINH", "nhom: SANG_LAP | VC | CHIEN_LUOC | ANGEL | NHAN_VIEN | KHAC"],
    ],
  },
  "giao-dich": {
    file: "mau-giao-dich-co-phan.csv",
    rows: [
      ["ngay", "loai_gd", "lop_co_phan", "so_co_phan", "ben_chuyen", "ben_nhan", "vong", "gia_cp", "so_tien", "tien_te", "so_hd", "ghi_chu"],
      ["01/03/2011", "PHAT_HANH", "CP_PT", "4.000.000", "", "INV-0001", "", "10000", "40.000.000.000", "VND", "Điều lệ 2011", "PHAT_HANH: bỏ trống bên chuyển"],
      ["10/11/2021", "CHUYEN_NHUONG", "CP_PT", "200.000", "INV-0001", "Công ty CP Ví Dụ", "", "", "", "VND", "SPA-01", "Bên: mã INV-xxxx hoặc tên chính xác"],
      ["02/05/2023", "MUA_LAI", "CP_PT", "100.000", "INV-0001", "", "", "", "", "VND", "NQ-HĐQT", "MUA_LAI: bỏ trống bên nhận"],
    ],
  },
};

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/templates/[kind]">) {
  if (!(await currentUser())) return new NextResponse("Unauthorized", { status: 401 });
  const t = TEMPLATES[(await ctx.params).kind];
  if (!t) return new NextResponse("Not found", { status: 404 });
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = "﻿" + t.rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${t.file}"`,
      "cache-control": "no-store",
    },
  });
}
