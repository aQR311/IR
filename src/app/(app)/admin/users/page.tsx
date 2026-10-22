import type { Metadata } from "next";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ROLE_LABEL } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { fmtDate, fmtDateTime, isoDate } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, TableWrap } from "@/components/ui";
import { createUserAction, revokeSessionsAction, updateUserAction } from "@/server/actions/admin";

export const metadata: Metadata = { title: "Tài khoản" };

const MONEY = { ROLE_DEFAULT: "Theo vai trò", NONE: "Ẩn tiền", FULL: "Xem tiền" } as const;

export default async function Users() {
  const me = await requireInternal("users.manage");
  const [users, investors, sessions] = await Promise.all([
    db.user.findMany({ orderBy: [{ kind: "asc" }, { role: "asc" }, { name: "asc" }], include: { investor: { select: { name: true } } } }),
    db.investor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true, account: { select: { id: true } } } }),
    db.session.groupBy({ by: ["userId"], where: { expiresAt: { gt: new Date() } }, _count: true }),
  ]);
  const live = Object.fromEntries(sessions.map((s) => [s.userId, s._count]));
  const domain = env().GOOGLE_ALLOWED_DOMAIN;

  return (
    <>
      <PageHeader title="Tài khoản & phân quyền" subtitle={`Nội bộ: email @${domain}, đăng nhập Lark / Google. Bên ngoài: OTP email, bắt buộc có hạn truy cập.`} />

      <Card title="Tạo tài khoản" className="mb-5">
        <ActionForm action={createUserAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Email" className="lg:col-span-2"><input name="email" type="email" required className="field" /></Field>
          <Field label="Họ tên" className="lg:col-span-2"><input name="name" required className="field" /></Field>
          <Field label="Vai trò">
            <select name="role" className="field">{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Dữ liệu tiền">
            <select name="moneyAccess" className="field">{Object.entries(MONEY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Gắn hồ sơ NĐT (cho Investor/Prospect)" className="lg:col-span-2">
            <select name="investorId" className="field">
              <option value="">—</option>
              {investors.filter((i) => !i.account).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
            </select>
          </Field>
          <Field label="Hạn truy cập (bắt buộc với bên ngoài)"><input type="date" name="accessExpires" className="field" /></Field>
          <div className="flex items-end"><Submit>Tạo tài khoản</Submit></div>
        </ActionForm>
      </Card>

      <TableWrap>
        <thead><tr><th>Người dùng</th><th>Loại</th><th>Vai trò · Tiền · Trạng thái · Hạn</th><th>Đăng nhập gần nhất</th><th>Phiên</th><th /></tr></thead>
        <tbody>
          {users.map((x) => (
            <tr key={x.id}>
              <td>
                <div className="font-medium">{x.name}</div>
                <div className="text-xs text-muted">{x.email}{x.investor ? ` · ${x.investor.name}` : ""}</div>
                <div className="mt-1 flex gap-1">
                  {x.larkOpenId && <Badge tone="accent">Lark</Badge>}
                  {x.googleSub && <Badge tone="accent">Google</Badge>}
                  {x.status === "SUSPENDED" && <Badge tone="bad">Đã khoá</Badge>}
                  {x.accessExpires && x.accessExpires < new Date() && <Badge tone="bad">Hết hạn</Badge>}
                </div>
              </td>
              <td><Badge>{x.kind === "INTERNAL" ? "Nội bộ" : "Bên ngoài"}</Badge></td>
              <td>
                {x.id === me.id ? (
                  <span className="text-xs text-muted">{ROLE_LABEL[x.role]} (bạn — không tự sửa quyền)</span>
                ) : (
                  <ActionForm action={updateUserAction} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="id" value={x.id} />
                    <select name="role" defaultValue={x.role} className="field w-auto" aria-label="Vai trò">{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select name="moneyAccess" defaultValue={x.moneyAccess} className="field w-auto" aria-label="Dữ liệu tiền">{Object.entries(MONEY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select name="status" defaultValue={x.status} className="field w-auto" aria-label="Trạng thái"><option value="ACTIVE">Hoạt động</option><option value="SUSPENDED">Khoá</option></select>
                    {x.kind === "EXTERNAL" && <input type="date" name="accessExpires" defaultValue={isoDate(x.accessExpires)} className="field w-auto" aria-label="Hạn truy cập" />}
                    <Submit variant="btn-ghost">Lưu</Submit>
                  </ActionForm>
                )}
              </td>
              <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(x.lastLoginAt)}{x.accessExpires && <div>Hạn: {fmtDate(x.accessExpires)}</div>}</td>
              <td className="num">{live[x.id] ?? 0}</td>
              <td>
                {x.id !== me.id && (live[x.id] ?? 0) > 0 && (
                  <ActionForm action={revokeSessionsAction} confirm={`Đăng xuất ${x.name} khỏi mọi thiết bị?`}>
                    <input type="hidden" name="id" value={x.id} />
                    <Submit variant="btn-danger">Đăng xuất hết</Submit>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p className="mt-2 text-xs text-muted">Đổi vai trò, quyền tiền hoặc khoá tài khoản sẽ huỷ ngay mọi phiên đăng nhập của người đó.</p>
    </>
  );
}
