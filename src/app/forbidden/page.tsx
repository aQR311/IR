import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-lg font-semibold">Không có quyền truy cập</h1>
      <p className="mt-2 text-sm text-muted">
        Tài khoản của bạn không được cấp quyền xem trang này. Nếu cần, hãy liên hệ Ban điều hành hoặc quản trị hệ thống.
      </p>
      <Link href="/" className="btn-ghost mt-6">
        Về trang chính
      </Link>
    </main>
  );
}
