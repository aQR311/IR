import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isPortalRole } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { CONF_LABEL, DOC_CATEGORY_LABEL, fmtDate, fmtPct, fmtShares } from "@/lib/format";
import { Badge, Card, Empty } from "@/components/ui";
import { logoutAction } from "@/server/actions/auth";
import { esopState, holdingOf } from "@/server/captable";

export const metadata: Metadata = { title: "Cổng nhà đầu tư" };

// Cổng NĐT (bản P0): chỉ dữ liệu của CHÍNH nhà đầu tư gắn với tài khoản. Không có danh sách cổ đông khác.
export default async function Portal() {
  const u = await requireUser();
  if (!isPortalRole(u.role)) redirect("/dashboard");
  if (!u.investorId) {
    return <main className="mx-auto max-w-2xl px-4 py-16 text-sm text-muted">Tài khoản chưa được gắn với hồ sơ nhà đầu tư. Vui lòng liên hệ bộ phận IR.</main>;
  }
  const [inv, holding, esop, classes, docs] = await Promise.all([
    db.investor.findUniqueOrThrow({ where: { id: u.investorId }, select: { name: true, code: true } }),
    holdingOf(u.investorId),
    esopState(),
    db.shareClass.findMany({ select: { id: true, code: true, name: true } }),
    db.document.findMany({
      where: { investorId: u.investorId, deletedAt: null, category: { in: ["CERTIFICATE", "CONTRACT", "RESOLUTION"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, category: true, confidentiality: true, createdAt: true },
    }),
  ]);
  const cls = Object.fromEntries(classes.map((c) => [c.id, c]));
  const grants = esop.grants.filter((g) => g.grant.holderId === u.investorId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-accent">Appota · Cổng nhà đầu tư</div>
          <h1 className="mt-1 text-xl font-semibold">{inv.name}</h1>
          <div className="text-sm text-muted">{inv.code}</div>
        </div>
        <form action={logoutAction}><button className="btn-ghost">Đăng xuất</button></form>
      </header>

      <Card title="Danh mục sở hữu của tôi">
        {u.role === "PROSPECT" ? (
          <p className="text-sm text-muted">Bạn đang ở giai đoạn tìm hiểu. Tài liệu thẩm định sẽ được mở trong Data Room (sắp ra mắt).</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-xs text-muted">Tổng cổ phần</div><div className="num text-2xl font-semibold">{fmtShares(holding.total)}</div></div>
              <div><div className="text-xs text-muted">Tỷ lệ sở hữu</div><div className="num text-2xl font-semibold">{fmtPct(holding.pct, 4)}</div></div>
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {Object.entries(holding.byClass).filter(([, q]) => q > 0n).map(([id, q]) => (
                <li key={id} className="flex justify-between border-b border-line py-1"><span>{cls[id]?.name}</span><span className="num">{fmtShares(q)}</span></li>
              ))}
            </ul>
          </>
        )}
        {grants.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium text-muted">Quyền ESOP</div>
            {grants.map(({ grant, summary }) => (
              <div key={grant.id} className="text-sm">{grant.code}: đã vest {fmtShares(summary.vested)} / {fmtShares(grant.quantity)} — có thể thực hiện {fmtShares(summary.exercisable)}</div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Chứng từ của tôi" className="mt-4">
        {docs.length === 0 ? <Empty>Chưa có chứng từ.</Empty> : (
          <ul className="space-y-1 text-sm">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <a href={`/api/files/${d.id}`} className="hover:underline">{d.title}</a>
                <span className="flex gap-1 text-xs text-muted">{fmtDate(d.createdAt)} <Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge><Badge>{CONF_LABEL[d.confidentiality]}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-6 text-xs text-muted">Bản tin IR, biểu quyết trực tuyến và Data Room sẽ có ở các phase tiếp theo.</p>
    </main>
  );
}
