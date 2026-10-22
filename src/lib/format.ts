import type { Prisma } from "@prisma/client";

export const fmtShares = (n: bigint | null | undefined) => (n ?? 0n).toLocaleString("vi-VN");

export const fmtPct = (n: number, digits = 2) =>
  `${n.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export function fmtMoney(v: Prisma.Decimal | string | null | undefined, currency = "VND") {
  if (v === null || v === undefined) return "—";
  const n = Number(v.toString());
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(n);
}

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";

export const fmtDateTime = (d: Date | null | undefined) =>
  d ? d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";

export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export const STAGE_LABEL: Record<string, string> = {
  LEAD: "Tiềm năng",
  CONTACTED: "Đã tiếp xúc",
  NDA: "Đã ký NDA",
  DUE_DILIGENCE: "Đang thẩm định",
  TERM_SHEET: "Term Sheet",
  COMMITTED: "Đã cam kết",
  SHAREHOLDER: "Cổ đông",
  PARTIAL_EXIT: "Exit một phần",
  EXITED: "Đã exit",
  DROPPED: "Dừng",
};

export const STAGE_GROUP: Record<string, "prospect" | "holder" | "exited" | "dropped"> = {
  LEAD: "prospect",
  CONTACTED: "prospect",
  NDA: "prospect",
  DUE_DILIGENCE: "prospect",
  TERM_SHEET: "prospect",
  COMMITTED: "prospect",
  SHAREHOLDER: "holder",
  PARTIAL_EXIT: "holder",
  EXITED: "exited",
  DROPPED: "dropped",
};

export const CATEGORY_LABEL: Record<string, string> = {
  FOUNDER: "Sáng lập",
  VC: "Quỹ VC",
  STRATEGIC: "Chiến lược",
  ANGEL: "Angel",
  EMPLOYEE: "Nhân viên",
  OTHER: "Khác",
};

export const TXN_KIND_LABEL: Record<string, string> = {
  ISSUE: "Phát hành",
  TRANSFER: "Chuyển nhượng",
  REDEMPTION: "Mua lại / huỷ",
};

export const TXN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nháp — chờ ghi sổ",
  POSTED: "Đã ghi sổ",
  CANCELLED: "Đã huỷ",
};

export const KYC_LABEL: Record<string, string> = {
  NOT_STARTED: "Chưa KYC",
  PENDING: "Đang KYC",
  VERIFIED: "Đã xác minh",
  REJECTED: "Từ chối",
};

export const CONF_LABEL: Record<string, string> = {
  INTERNAL: "Nội bộ",
  CONFIDENTIAL: "Mật",
  STRICT: "Tối mật",
};

export const DOC_CATEGORY_LABEL: Record<string, string> = {
  CONTRACT: "Hợp đồng",
  CERTIFICATE: "Chứng nhận CP",
  KYC: "KYC",
  RESOLUTION: "Nghị quyết",
  FINANCIAL: "Tài chính",
  OTHER: "Khác",
};

export const CONVERTIBLE_LABEL: Record<string, string> = {
  SAFE_POST: "SAFE (post-money)",
  SAFE_PRE: "SAFE (pre-money)",
  CONVERTIBLE_NOTE: "Trái phiếu chuyển đổi",
};
