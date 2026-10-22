import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import {
  CATEGORY_LABEL, CONF_LABEL, CONVERTIBLE_LABEL, DOC_CATEGORY_LABEL, KYC_LABEL, STAGE_LABEL,
  TXN_KIND_LABEL, TXN_STATUS_LABEL, fmtDate, fmtMoney, fmtPct, fmtShares, isoDate,
} from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Empty, Field, Hidden, PageHeader } from "@/components/ui";
import {
  addContactAction, addInteractionAction, changeStageAction, updateInvestorAction, updateKycAction,
} from "@/server/actions/investors";
import { holdingOf, esopState } from "@/server/captable";
import { InvestorFields } from "../investor-fields";
import { irOwners, stageTone } from "../shared";
import { KycReveal } from "./kyc-reveal";

export const metadata: Metadata = { title: "Hồ sơ nhà đầu tư" };

const MANUAL_STAGES = ["LEAD", "CONTACTED", "NDA", "DUE_DILIGENCE", "TERM_SHEET", "COMMITTED", "DROPPED"];

export default async function InvestorDetail({ params }: PageProps<"/investors/[id]">) {
  const u = await requireInternal("investors.view");
  const { id } = await params;
  const inv = await db.investor.findUnique({
    where: { id },
    include: {
      irOwner: { select: { name: true } },
      contacts: { orderBy: { createdAt: "asc" } },
      interactions: { orderBy: { date: "desc" }, take: 30, include: { user: { select: { name: true } } } },
      stageHistory: { orderBy: { at: "desc" }, take: 20 },
      convertibles: { orderBy: { issueDate: "asc" } },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!inv) notFound();

  const canEdit = can(u, "investors.edit");
  const seeCap = can(u, "captable.view");
  const [holding, esop, classes, txns, owners] = await Promise.all([
    seeCap ? holdingOf(inv.id) : null,
    seeCap ? esopState() : null,
    db.shareClass.findMany({ select: { id: true, code: true, name: true } }),
    seeCap
      ? db.shareTransaction.findMany({
          where: { OR: [{ toInvestorId: inv.id }, { fromInvestorId: inv.id }] },
          orderBy: { seq: "desc" },
          include: { shareClass: { select: { code: true } } },
        })
      : [],
    canEdit ? irOwners() : [],
  ]);
  const grants = esop?.grants.filter((g) => g.grant.holderId === inv.id) ?? [];
  const className = Object.fromEntries(classes.map((c) => [c.id, c.code]));

  return (
    <>
      <PageHeader
        title={inv.name}
        subtitle={`${inv.code} · ${CATEGORY_LABEL[inv.category]} · ${inv.type === "ORGANIZATION" ? "Tổ chức" : "Cá nhân"}${inv.isForeign ? ` · Nước ngoài (${inv.country})` : ""}`}
        actions={<Badge tone={stageTone(inv.stage)}>{STAGE_LABEL[inv.stage]}</Badge>}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {holding && (
            <Card title="Sở hữu hiện tại">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><div className="text-xs text-muted">Tổng cổ phần</div><div className="num text-lg font-semibold">{fmtShares(holding.total)}</div></div>
                <div><div className="text-xs text-muted">Tỷ lệ (cơ sở)</div><div className="num text-lg font-semibold">{fmtPct(holding.pct, 4)}</div></div>
                {Object.entries(holding.byClass).filter(([, q]) => q > 0n).map(([cls, q]) => (
                  <div key={cls}><div className="text-xs text-muted">{className[cls]}</div><div className="num font-medium">{fmtShares(q)}</div></div>
                ))}
              </div>
              {grants.length > 0 && (
                <div className="mt-4 border-t border-line pt-3 text-sm">
                  <div className="mb-1 text-xs font-medium text-muted">Quyền ESOP</div>
                  {grants.map(({ grant, summary }) => (
                    <div key={grant.id} className="flex flex-wrap gap-x-4">
                      <span className="font-medium">{grant.code}</span>
                      <span>Cấp: <span className="num">{fmtShares(grant.quantity)}</span></span>
                      <span>Đã vest: <span className="num">{fmtShares(summary.vested)}</span></span>
                      <span>Có thể thực hiện: <span className="num">{fmtShares(summary.exercisable)}</span></span>
                    </div>
                  ))}
                </div>
              )}
              {inv.convertibles.length > 0 && (
                <div className="mt-4 border-t border-line pt-3 text-sm">
                  <div className="mb-1 text-xs font-medium text-muted">Khoản đầu tư chuyển đổi</div>
                  {inv.convertibles.map((c) => (
                    <div key={c.id} className="flex flex-wrap gap-x-4">
                      <span className="font-medium">{c.code}</span>
                      <span>{CONVERTIBLE_LABEL[c.kind]}</span>
                      <span>{u.seeMoney ? fmtMoney(c.principal, c.currency) : <Hidden />}</span>
                      <Badge tone={c.status === "OUTSTANDING" ? "warn" : "neutral"}>{c.status === "OUTSTANDING" ? "Chưa chuyển đổi" : c.status === "CONVERTED" ? "Đã chuyển đổi" : "Đã huỷ"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {seeCap && (
            <Card title="Lịch sử giao dịch cổ phần">
              {txns.length === 0 ? <Empty>Chưa có giao dịch.</Empty> : (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>#</th><th>Ngày</th><th>Loại</th><th>Lớp</th><th className="text-right">Số CP</th><th>Chiều</th><th>Trạng thái</th></tr></thead>
                    <tbody>
                      {txns.map((t) => (
                        <tr key={t.id}>
                          <td className="num text-muted">{t.seq}</td>
                          <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
                          <td>{TXN_KIND_LABEL[t.kind]}</td>
                          <td>{t.shareClass.code}</td>
                          <td className="num text-right">{fmtShares(t.quantity)}</td>
                          <td>{t.toInvestorId === inv.id ? <Badge tone="ok">Nhận</Badge> : <Badge tone="warn">Chuyển ra</Badge>}</td>
                          <td><Badge tone={t.status === "POSTED" ? "ok" : t.status === "DRAFT" ? "warn" : "neutral"}>{TXN_STATUS_LABEL[t.status]}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <Card title="Lịch sử tương tác">
            {canEdit && (
              <ActionForm action={addInteractionAction} resetOnSuccess className="mb-4 grid gap-2 sm:grid-cols-[140px_130px_1fr_auto] sm:items-end">
                <input type="hidden" name="investorId" value={inv.id} />
                <Field label="Ngày"><input type="date" name="date" required defaultValue={isoDate(new Date())} className="field" /></Field>
                <Field label="Hình thức">
                  <select name="kind" className="field">
                    <option value="MEETING">Họp</option><option value="CALL">Gọi</option><option value="EMAIL">Email</option><option value="NOTE">Ghi chú</option>
                  </select>
                </Field>
                <Field label="Nội dung / cam kết"><input name="summary" required className="field" /></Field>
                <Submit>Ghi</Submit>
              </ActionForm>
            )}
            {inv.interactions.length === 0 ? <Empty>Chưa có tương tác.</Empty> : (
              <ul className="space-y-2 text-sm">
                {inv.interactions.map((i) => (
                  <li key={i.id} className="border-b border-line pb-2 last:border-0">
                    <div className="text-xs text-muted">{fmtDate(i.date)} · {i.kind} · {i.user.name}</div>
                    <div className="whitespace-pre-wrap">{i.summary}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canEdit && (
            <Card title="Hồ sơ">
              <ActionForm action={updateInvestorAction}>
                <input type="hidden" name="id" value={inv.id} />
                <InvestorFields inv={inv} owners={owners} />
                <div className="mt-4"><Submit>Lưu hồ sơ</Submit></div>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Vòng đời">
            {canEdit && inv.stage !== "SHAREHOLDER" && inv.stage !== "PARTIAL_EXIT" && (
              <ActionForm action={changeStageAction} className="mb-3 grid gap-2">
                <input type="hidden" name="id" value={inv.id} />
                <select name="stage" defaultValue={MANUAL_STAGES.includes(inv.stage) ? inv.stage : "LEAD"} className="field" aria-label="Trạng thái">
                  {MANUAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <input name="note" placeholder="Ghi chú (tuỳ chọn)" className="field" />
                <Submit variant="btn-ghost">Chuyển trạng thái</Submit>
              </ActionForm>
            )}
            <p className="mb-2 text-xs text-muted">Cổ đông / Exit một phần / Đã exit được cập nhật tự động khi giao dịch cổ phần được ghi sổ.</p>
            <ul className="space-y-1 text-xs">
              {inv.stageHistory.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span>{s.from ? `${STAGE_LABEL[s.from]} → ` : ""}<b>{STAGE_LABEL[s.to]}</b>{s.note ? ` · ${s.note}` : ""}</span>
                  <span className="shrink-0 text-muted">{fmtDate(s.at)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="KYC">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-muted">Trạng thái</span>
              <Badge tone={inv.kycStatus === "VERIFIED" ? "ok" : inv.kycStatus === "REJECTED" ? "bad" : "warn"}>{KYC_LABEL[inv.kycStatus]}</Badge>
            </div>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-muted">Số CCCD / Hộ chiếu / ĐKKD</dt><dd>{can(u, "kyc.reveal") ? <KycReveal investorId={inv.id} field="idNumber" present={!!inv.idNumberEnc} /> : <Hidden label={inv.idNumberEnc ? "Đã lưu (mã hoá)" : "Chưa có"} />}</dd></div>
              <div><dt className="text-xs text-muted">Tài khoản nhận cổ tức</dt><dd>{can(u, "kyc.reveal") ? <KycReveal investorId={inv.id} field="bankAccount" present={!!inv.bankAccountEnc} /> : <Hidden label={inv.bankAccountEnc ? "Đã lưu (mã hoá)" : "Chưa có"} />}</dd></div>
              <div><dt className="text-xs text-muted">Mã số thuế</dt><dd>{inv.taxCode ?? "—"}</dd></div>
            </dl>
            {can(u, "kyc.edit") && (
              <ActionForm action={updateKycAction} resetOnSuccess className="mt-4 grid gap-2 border-t border-line pt-3">
                <input type="hidden" name="investorId" value={inv.id} />
                <input name="idNumber" placeholder="Số giấy tờ mới (để trống nếu không đổi)" className="field" autoComplete="off" />
                <input name="bankAccount" placeholder="Tài khoản ngân hàng mới" className="field" autoComplete="off" />
                <select name="kycStatus" defaultValue={inv.kycStatus} className="field" aria-label="Trạng thái KYC">
                  {Object.entries(KYC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <Submit variant="btn-ghost">Cập nhật KYC</Submit>
              </ActionForm>
            )}
          </Card>

          <Card title="Đầu mối liên hệ">
            <ul className="space-y-2 text-sm">
              {inv.contacts.map((c) => (
                <li key={c.id}>
                  <div className="font-medium">{c.name}{c.title ? <span className="font-normal text-muted"> · {c.title}</span> : null}</div>
                  <div className="text-xs text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
              {inv.contacts.length === 0 && <li className="text-muted">Chưa có đầu mối.</li>}
            </ul>
            {canEdit && (
              <ActionForm action={addContactAction} resetOnSuccess className="mt-3 grid gap-2 border-t border-line pt-3">
                <input type="hidden" name="investorId" value={inv.id} />
                <input name="name" required placeholder="Họ tên" className="field" />
                <input name="title" placeholder="Chức danh" className="field" />
                <input name="email" type="email" placeholder="Email" className="field" />
                <input name="phone" placeholder="Điện thoại" className="field" />
                <Submit variant="btn-ghost">Thêm đầu mối</Submit>
              </ActionForm>
            )}
          </Card>

          <Card title="Tài liệu" actions={can(u, "documents.upload") && <Link href={`/documents?investorId=${inv.id}`} className="text-xs text-accent">Tải lên</Link>}>
            {inv.documents.length === 0 ? <Empty>Chưa có tài liệu.</Empty> : (
              <ul className="space-y-1 text-sm">
                {inv.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <a href={`/api/files/${d.id}`} className="truncate hover:underline">{d.title}</a>
                    <span className="flex shrink-0 gap-1"><Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge><Badge tone={d.confidentiality === "STRICT" ? "bad" : d.confidentiality === "CONFIDENTIAL" ? "warn" : "neutral"}>{CONF_LABEL[d.confidentiality]}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
