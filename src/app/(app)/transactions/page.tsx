import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { TXN_KIND_LABEL, TXN_STATUS_LABEL, fmtDate, fmtMoney, fmtShares, isoDate } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Empty, Field, Hidden, PageHeader, TableWrap } from "@/components/ui";
import { cancelTxnAction, createTxnAction, postTxnAction, reverseTxnAction } from "@/server/actions/transactions";

export const metadata: Metadata = { title: "Sổ giao dịch" };

export default async function Transactions({ searchParams }: PageProps<"/transactions">) {
  const u = await requireInternal("captable.view");
  const sp = await searchParams;
  const status = sp.status === "DRAFT" || sp.status === "POSTED" || sp.status === "CANCELLED" ? sp.status : undefined;

  const [txns, investors, classes, rounds, users] = await Promise.all([
    db.shareTransaction.findMany({
      where: status ? { status } : {},
      orderBy: { seq: "desc" },
      take: 300,
      include: {
        shareClass: { select: { code: true } },
        fromInvestor: { select: { id: true, name: true } },
        toInvestor: { select: { id: true, name: true } },
        round: { select: { code: true } },
        reversedBy: { select: { seq: true } },
      },
    }),
    db.investor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    db.shareClass.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.fundingRound.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, code: true, name: true } }),
    db.user.findMany({ where: { kind: "INTERNAL" }, select: { id: true, name: true } }),
  ]);
  const userName = Object.fromEntries(users.map((x) => [x.id, x.name]));
  const canCreate = can(u, "txn.create");
  const canPost = can(u, "txn.post");

  return (
    <>
      <PageHeader
        title="Sổ giao dịch cổ phần"
        subtitle="Sổ cái chỉ ghi thêm. Giao dịch đã ghi sổ không sửa / xoá được — sai thì tạo bút toán đối ứng."
        actions={
          <>
            {[undefined, "DRAFT", "POSTED", "CANCELLED"].map((s) => (
              <Link key={s ?? "all"} href={s ? `/transactions?status=${s}` : "/transactions"} className={status === s ? "btn" : "btn-ghost"}>
                {s ? TXN_STATUS_LABEL[s].split(" —")[0] : "Tất cả"}
              </Link>
            ))}
          </>
        }
      />

      {canCreate && (
        <Card title="Tạo giao dịch (nháp)" className="mb-5">
          <ActionForm action={createTxnAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Loại">
              <select name="kind" className="field">
                {Object.entries(TXN_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Ngày hiệu lực"><input type="date" name="date" required defaultValue={isoDate(new Date())} className="field" /></Field>
            <Field label="Lớp cổ phần">
              <select name="shareClassId" className="field">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </Field>
            <Field label="Số cổ phần"><input name="quantity" inputMode="numeric" required className="field num" /></Field>
            <Field label="Bên chuyển (chuyển nhượng / mua lại)">
              <select name="fromInvestorId" className="field">
                <option value="">—</option>
                {investors.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </select>
            </Field>
            <Field label="Bên nhận (phát hành / chuyển nhượng)">
              <select name="toInvestorId" className="field">
                <option value="">—</option>
                {investors.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </select>
            </Field>
            <Field label="Vòng gọi vốn">
              <select name="roundId" className="field">
                <option value="">—</option>
                {rounds.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
              </select>
            </Field>
            <Field label="Số HĐ / Nghị quyết"><input name="docRef" className="field" /></Field>
            {u.seeMoney && (
              <>
                <Field label="Giá / CP"><input name="pricePerShare" inputMode="decimal" className="field num" /></Field>
                <Field label="Tổng giá trị"><input name="amount" inputMode="decimal" className="field num" /></Field>
                <Field label="Tiền tệ">
                  <select name="currency" className="field">
                    {["VND", "USD", "SGD", "JPY", "KRW", "EUR"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Tỷ giá quy đổi VND"><input name="fxRate" inputMode="decimal" className="field num" /></Field>
              </>
            )}
            <Field label="Ghi chú" className="sm:col-span-2 lg:col-span-3"><input name="note" className="field" /></Field>
            <div className="flex items-end"><Submit>Tạo nháp</Submit></div>
          </ActionForm>
        </Card>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th>#</th><th>Ngày</th><th>Loại</th><th>Từ → Đến</th><th>Lớp</th>
            <th className="text-right">Số CP</th><th className="text-right">Giá trị</th><th>Trạng thái</th><th>Tạo / Ghi sổ</th><th />
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.id}>
              <td className="num text-muted">{t.seq}</td>
              <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
              <td className="whitespace-nowrap">
                {TXN_KIND_LABEL[t.kind]}
                {t.esopGrantId && <div className="text-xs text-muted">ESOP</div>}
                {t.convertibleId && <div className="text-xs text-muted">Chuyển đổi SAFE</div>}
                {t.reversesId && <div className="text-xs text-warn">Bút toán đối ứng</div>}
              </td>
              <td className="min-w-48">
                {t.fromInvestor ? <Link href={`/investors/${t.fromInvestor.id}`} className="hover:underline">{t.fromInvestor.name}</Link> : <span className="text-muted">Công ty</span>}
                {" → "}
                {t.toInvestor ? <Link href={`/investors/${t.toInvestor.id}`} className="hover:underline">{t.toInvestor.name}</Link> : <span className="text-muted">Công ty (huỷ)</span>}
                {t.note && <div className="text-xs text-muted">{t.note}</div>}
                {t.docRef && <div className="text-xs text-muted">Số: {t.docRef}</div>}
              </td>
              <td>{t.shareClass.code}{t.round && <div className="text-xs text-muted">{t.round.code}</div>}</td>
              <td className="num text-right">{fmtShares(t.quantity)}</td>
              <td className="num whitespace-nowrap text-right">{u.seeMoney ? fmtMoney(t.amount, t.currency) : <Hidden />}</td>
              <td>
                <Badge tone={t.status === "POSTED" ? "ok" : t.status === "DRAFT" ? "warn" : "neutral"}>{TXN_STATUS_LABEL[t.status]}</Badge>
                {t.reversedBy && <div className="mt-1 text-xs text-muted">Đã đảo bởi #{t.reversedBy.seq}</div>}
              </td>
              <td className="whitespace-nowrap text-xs text-muted">
                {userName[t.createdById] ?? "?"}
                {t.postedById && <div>✓ {userName[t.postedById] ?? "?"}</div>}
              </td>
              <td className="whitespace-nowrap">
                {t.status === "DRAFT" && (
                  <div className="flex flex-col gap-1">
                    {canPost && t.createdById !== u.id && (
                      <ActionForm action={postTxnAction} confirm={`Ghi sổ giao dịch #${t.seq}? Sau khi ghi sổ không thể sửa.`}>
                        <input type="hidden" name="id" value={t.id} />
                        <Submit>Ghi sổ</Submit>
                      </ActionForm>
                    )}
                    {canPost && t.createdById === u.id && <span className="text-xs text-muted">Chờ người khác duyệt</span>}
                    {canCreate && (
                      <ActionForm action={cancelTxnAction} confirm="Huỷ giao dịch nháp này?">
                        <input type="hidden" name="id" value={t.id} />
                        <Submit variant="btn-danger">Huỷ</Submit>
                      </ActionForm>
                    )}
                  </div>
                )}
                {t.status === "POSTED" && canCreate && !t.reversedBy && !t.reversesId && !t.esopGrantId && !t.convertibleId && (
                  <details>
                    <summary className="cursor-pointer text-xs text-accent">Đảo</summary>
                    <ActionForm action={reverseTxnAction} className="mt-1 grid w-56 gap-1">
                      <input type="hidden" name="id" value={t.id} />
                      <input name="note" required placeholder="Lý do đảo" className="field" />
                      <Submit variant="btn-ghost">Tạo bút toán đối ứng</Submit>
                    </ActionForm>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {txns.length === 0 && <Empty>Chưa có giao dịch.</Empty>}
    </>
  );
}
