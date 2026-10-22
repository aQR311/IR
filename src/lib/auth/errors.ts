// Mã lỗi đăng nhập → thông điệp. Trang login chỉ hiển thị thông điệp trong bảng này,
// không bao giờ hiển thị chuỗi lấy từ URL (chống chèn nội dung lừa đảo vào trang đăng nhập).
export const LOGIN_ERRORS = {
  provider: "Phương thức đăng nhập chưa được cấu hình.",
  rate_limited: "Quá nhiều lần thử. Vui lòng đợi 15 phút.",
  bad_state: "Phiên đăng nhập không hợp lệ hoặc đã quá hạn, vui lòng thử lại.",
  sso_rejected: "Tài khoản không thuộc tổ chức Appota hoặc chưa xác minh.",
  not_provisioned: "Tài khoản chưa được cấp quyền truy cập hệ thống. Liên hệ quản trị.",
  wrong_kind: "Tài khoản này không dùng đăng nhập nội bộ.",
  suspended: "Tài khoản đang bị khoá.",
  identity_mismatch: "Định danh SSO không khớp với tài khoản đã gắn. Liên hệ quản trị.",
  session_expired: "Phiên làm việc đã hết hạn, vui lòng đăng nhập lại.",
  reauth: "Thao tác này cần xác thực lại. Vui lòng đăng nhập lại.",
} as const;

export type LoginError = keyof typeof LOGIN_ERRORS;

export const loginErrorMessage = (code: string | undefined) =>
  code && code in LOGIN_ERRORS ? LOGIN_ERRORS[code as LoginError] : null;
