import type { MoneyAccess, Role } from "@prisma/client";

// Quyền chi tiết. Kiểm tra ở server cho mọi trang, server action và route.
export const PERMISSIONS = [
  "investors.view",
  "investors.edit",
  "kyc.reveal",
  "kyc.edit",
  "captable.view",
  "captable.export",
  "equity.configure", // lớp cổ phần, vòng gọi vốn, ngưỡng cổ đông lớn
  "data.import",
  "txn.create",
  "txn.post",
  "esop.view",
  "esop.manage",
  "convertibles.manage",
  "documents.view",
  "documents.confidential",
  "documents.strict",
  "documents.upload",
  "audit.view",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_BUSINESS = PERMISSIONS.filter((p) => p !== "users.manage");

// SYS_ADMIN (IT) quản lý tài khoản nhưng KHÔNG xem được dữ liệu vốn — tách quyền hệ thống khỏi quyền nghiệp vụ.
const ROLE_PERMS: Record<Role, readonly Permission[]> = {
  SYS_ADMIN: ["users.manage", "audit.view"],
  EXEC: ALL_BUSINESS,
  IR_LEAD: [
    "investors.view", "investors.edit", "kyc.reveal", "captable.view", "esop.view",
    "documents.view", "documents.confidential", "documents.upload",
  ],
  IR_STAFF: ["investors.view", "investors.edit", "documents.view", "documents.upload"],
  LEGAL: [
    "investors.view", "investors.edit", "kyc.reveal", "kyc.edit", "captable.view", "txn.create",
    "esop.view", "convertibles.manage", "documents.view", "documents.confidential", "documents.upload",
    "equity.configure", "data.import",
  ],
  FINANCE: [
    "investors.view", "captable.view", "captable.export", "txn.create", "txn.post", "esop.view",
    "convertibles.manage", "documents.view", "documents.confidential", "documents.upload",
  ],
  HR_ESOP: ["investors.view", "esop.view", "esop.manage", "documents.view", "documents.upload"],
  AUDITOR: [
    "investors.view", "captable.view", "esop.view", "documents.view", "documents.confidential",
    "audit.view",
  ],
  // Nhà đầu tư chỉ vào cổng riêng /portal, chỉ thấy dữ liệu của chính mình.
  INVESTOR: [],
  PROSPECT: [],
};

const MONEY_DEFAULT: Record<Role, boolean> = {
  SYS_ADMIN: false,
  EXEC: true,
  IR_LEAD: true,
  IR_STAFF: false,
  LEGAL: true,
  FINANCE: true,
  HR_ESOP: false,
  AUDITOR: true,
  INVESTOR: false,
  PROSPECT: false,
};

export type Viewer = { id: string; role: Role; moneyAccess: MoneyAccess };

export function can(v: Pick<Viewer, "role">, p: Permission): boolean {
  return ROLE_PERMS[v.role].includes(p);
}

/** Có được xem định giá, số tiền đầu tư, giá cổ phần, giá thực hiện ESOP không. */
export function canSeeMoney(v: Pick<Viewer, "role" | "moneyAccess">): boolean {
  if (v.moneyAccess === "NONE") return false;
  if (v.moneyAccess === "FULL") return v.role !== "INVESTOR" && v.role !== "PROSPECT";
  return MONEY_DEFAULT[v.role];
}

export const isPortalRole = (role: Role) => role === "INVESTOR" || role === "PROSPECT";

export const ROLE_LABEL: Record<Role, string> = {
  SYS_ADMIN: "Quản trị hệ thống (IT)",
  EXEC: "Ban điều hành (CEO/CFO)",
  IR_LEAD: "Trưởng IR",
  IR_STAFF: "Chuyên viên IR",
  LEGAL: "Pháp chế / Thư ký công ty",
  FINANCE: "Kế toán / Tài chính",
  HR_ESOP: "Nhân sự C&B (ESOP)",
  AUDITOR: "Kiểm toán / Tư vấn ngoài",
  INVESTOR: "Nhà đầu tư / Cổ đông",
  PROSPECT: "Nhà đầu tư tiềm năng",
};

export const permissionsOf = (role: Role) => ROLE_PERMS[role];
