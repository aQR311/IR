import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { devLoginEnabled, googleEnabled, larkEnabled } from "@/lib/env";
import { loginErrorMessage } from "@/lib/auth/errors";
import { safeNext } from "@/lib/auth/oauth";
import { ROLE_LABEL } from "@/lib/permissions";
import { currentUser, homeFor } from "@/lib/session";
import { devLoginAction } from "@/server/actions/auth";
import { OtpLogin } from "./otp-login";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = loginErrorMessage(typeof sp.error === "string" ? sp.error : undefined);
  const next = safeNext(typeof sp.next === "string" ? sp.next : "");
  const reauth = sp.error === "reauth";

  const u = await currentUser();
  if (u && !reauth) redirect(homeFor(u.role));

  const qs = next ? `?next=${encodeURIComponent(next)}` : "";
  const devUsers = devLoginEnabled()
    ? await db.user.findMany({ where: { status: "ACTIVE" }, orderBy: [{ kind: "asc" }, { role: "asc" }], select: { email: true, name: true, role: true } })
    : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-accent">Appota</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">IR & Equity Hub</h1>
        <p className="mt-1 text-sm text-muted">Quản trị nhà đầu tư, cổ đông và Cap Table.</p>
      </div>

      {error && <p className="mb-4 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Nhân sự Appota</h2>
        <div className="mt-3 grid gap-2">
          <a href={`/api/auth/lark/start${qs}`} className={larkEnabled() ? "btn" : "btn-ghost pointer-events-none opacity-50"}>
            Đăng nhập bằng Lark
          </a>
          <a href={`/api/auth/google/start${qs}`} className={googleEnabled() ? "btn-ghost" : "btn-ghost pointer-events-none opacity-50"}>
            Đăng nhập bằng Google Workspace
          </a>
          {!larkEnabled() && !googleEnabled() && (
            <p className="text-xs text-muted">Chưa cấu hình Lark / Google (xem .env.example).</p>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Nhà đầu tư, kiểm toán & đối tác</h2>
        <p className="mt-1 text-xs text-muted">Nhận mã dùng một lần qua email đã đăng ký. Không dùng mật khẩu.</p>
        <OtpLogin />
      </section>

      {devUsers.length > 0 && (
        <section className="mt-4 rounded-lg border border-dashed border-warn bg-warn-soft p-4">
          <h2 className="text-sm font-semibold text-warn">Đăng nhập nhanh (chỉ máy dev)</h2>
          <p className="mt-1 text-xs text-muted">Bị chặn cứng ở production. Tắt bằng ALLOW_DEV_LOGIN=false.</p>
          <form action={devLoginAction} className="mt-3 flex gap-2">
            <select name="email" className="field" aria-label="Tài khoản dev">
              {devUsers.map((d) => (
                <option key={d.email} value={d.email}>
                  {d.name} — {ROLE_LABEL[d.role]}
                </option>
              ))}
            </select>
            <button className="btn-ghost shrink-0" type="submit">Vào</button>
          </form>
        </section>
      )}
    </main>
  );
}
