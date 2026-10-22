import { requireInternal } from "@/lib/session";
import { can, ROLE_LABEL, type Permission } from "@/lib/permissions";
import { logoutAction } from "@/server/actions/auth";
import { NavLinks } from "./nav-links";

// perm là mảng = có một trong các quyền là thấy mục.
const NAV: { href: string; label: string; perm: Permission | Permission[] | null }[] = [
  { href: "/dashboard", label: "Tổng quan", perm: null },
  { href: "/investors", label: "Nhà đầu tư", perm: "investors.view" },
  { href: "/captable", label: "Cap Table", perm: "captable.view" },
  { href: "/transactions", label: "Sổ giao dịch", perm: "captable.view" },
  { href: "/esop", label: "ESOP", perm: "esop.view" },
  { href: "/convertibles", label: "SAFE / Chuyển đổi", perm: "captable.view" },
  { href: "/documents", label: "Tài liệu", perm: "documents.view" },
  { href: "/import", label: "Nhập dữ liệu", perm: ["data.import", "txn.post"] },
  { href: "/settings/equity", label: "Cấu hình vốn", perm: "equity.configure" },
  { href: "/audit", label: "Nhật ký kiểm toán", perm: "audit.view" },
  { href: "/admin/users", label: "Tài khoản", perm: "users.manage" },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const u = await requireInternal();
  const items = NAV.filter((n) => !n.perm || [n.perm].flat().some((p) => can(u, p))).map(({ href, label }) => ({ href, label }));
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent">Appota</div>
            <div className="text-sm font-semibold">IR & Equity Hub</div>
          </div>
        </div>
        <NavLinks items={items} />
        <div className="hidden border-t border-line px-4 py-3 md:absolute md:bottom-0 md:block md:w-60">
          <div className="truncate text-sm font-medium">{u.name}</div>
          <div className="truncate text-xs text-muted">{ROLE_LABEL[u.role]}</div>
          {!u.seeMoney && <div className="mt-1 text-[11px] text-warn">Ẩn dữ liệu tiền</div>}
          <form action={logoutAction} className="mt-2">
            <button className="text-xs text-muted underline hover:text-ink">Đăng xuất</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-4 flex items-center justify-between gap-2 text-xs text-muted md:hidden">
          <span className="truncate">{u.name} · {ROLE_LABEL[u.role]}</span>
          <form action={logoutAction}>
            <button className="underline">Đăng xuất</button>
          </form>
        </div>
        {children}
      </main>
    </div>
  );
}
