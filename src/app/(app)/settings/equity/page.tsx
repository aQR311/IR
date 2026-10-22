import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/session";
import { fmtDate, fmtMoney, isoDate } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Card, Field, Hidden, PageHeader } from "@/components/ui";
import { majorThresholdPct } from "@/server/captable";
import {
  createShareClassAction, saveRoundAction, setMajorThresholdAction, updateShareClassAction,
} from "@/server/actions/equity-config";

export const metadata: Metadata = { title: "Cấu hình vốn" };

const ROUND_STATUS = { PLANNED: "Dự kiến", OPEN: "Đang gọi vốn", CLOSED: "Đã đóng" } as const;
const CURRENCIES = ["VND", "USD", "SGD", "JPY", "KRW", "EUR"];

export default async function EquitySettings() {
  const u = await requireInternal("equity.configure");
  const [classes, rounds, threshold, used] = await Promise.all([
    db.shareClass.findMany({ orderBy: [{ seniority: "desc" }, { code: "asc" }] }),
    db.fundingRound.findMany({ orderBy: { createdAt: "asc" } }),
    majorThresholdPct(),
    db.shareTransaction.groupBy({ by: ["shareClassId"], _count: true }),
  ]);
  const usedCount = Object.fromEntries(used.map((x) => [x.shareClassId, x._count]));

  return (
    <>
      <PageHeader title="Cấu hình vốn" subtitle="Lớp cổ phần, vòng gọi vốn và ngưỡng cổ đông lớn — cần thiết lập trước khi nhập Cap Table" />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Lớp cổ phần">
          <div className="space-y-3">
            {classes.map((c) => (
              <details key={c.id} className="rounded-md border border-line">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{c.code}</span>
                  <span className="text-muted">{c.name}</span>
                  <Badge tone={c.kind === "COMMON" ? "neutral" : "accent"}>{c.kind === "COMMON" ? "Phổ thông" : "Ưu đãi"}</Badge>
                  <span className="ml-auto text-xs text-muted">{usedCount[c.id] ?? 0} giao dịch</span>
                </summary>
                <ActionForm action={updateShareClassAction} className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} />
                  <ClassFields c={c} />
                  <div className="sm:col-span-2"><Submit variant="btn-ghost">Lưu</Submit></div>
                </ActionForm>
              </details>
            ))}
          </div>
          <ActionForm action={createShareClassAction} resetOnSuccess className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
            <div className="text-xs font-semibold text-muted sm:col-span-2">Thêm lớp mới</div>
            <Field label="Mã (vd CP_PT, UD_B)"><input name="code" required className="field uppercase" /></Field>
            <Field label="Loại">
              <select name="kind" className="field"><option value="COMMON">Phổ thông</option><option value="PREFERRED">Ưu đãi</option></select>
            </Field>
            <Field label="Mệnh giá (VND)"><input name="parValue" defaultValue="10000" className="field num" /></Field>
            <ClassFields />
            <div className="sm:col-span-2"><Submit>Tạo lớp cổ phần</Submit></div>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Mã, loại và mệnh giá không sửa được sau khi tạo vì đã gắn với giao dịch trên sổ cái.</p>
        </Card>

        <div className="space-y-4">
          <Card title="Vòng gọi vốn">
            <div className="space-y-3">
              {rounds.map((r) => (
                <details key={r.id} className="rounded-md border border-line">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{r.code}</span>
                    <span className="text-muted">{r.name}</span>
                    <Badge tone={r.status === "OPEN" ? "ok" : "neutral"}>{ROUND_STATUS[r.status]}</Badge>
                    <span className="ml-auto text-xs text-muted">
                      {fmtDate(r.closeDate)} · {u.seeMoney ? (r.pricePerShare ? `${fmtMoney(r.pricePerShare, r.currency)}/CP` : "—") : <Hidden />}
                    </span>
                  </summary>
                  <ActionForm action={saveRoundAction} className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={r.id} />
                    <RoundFields r={r} seeMoney={u.seeMoney} />
                    <div className="sm:col-span-2"><Submit variant="btn-ghost">Lưu</Submit></div>
                  </ActionForm>
                </details>
              ))}
            </div>
            <ActionForm action={saveRoundAction} resetOnSuccess className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
              <div className="text-xs font-semibold text-muted sm:col-span-2">Thêm vòng mới</div>
              <Field label="Mã (vd SEED_2014)"><input name="code" required className="field uppercase" /></Field>
              <RoundFields seeMoney={u.seeMoney} />
              <div className="sm:col-span-2"><Submit>Tạo vòng</Submit></div>
            </ActionForm>
          </Card>

          <Card title="Ngưỡng cổ đông lớn">
            <ActionForm action={setMajorThresholdAction} className="flex flex-wrap items-end gap-2">
              <Field label="Sở hữu từ (% tổng cổ phần đã phát hành)">
                <input name="pct" type="number" step="0.1" min="0.1" max="100" defaultValue={threshold} className="field num w-32" />
              </Field>
              <Submit variant="btn-ghost">Lưu</Submit>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">Theo Luật Doanh nghiệp 2020 các mốc thường gặp là 5% và 10% cổ phần phổ thông — Pháp chế xác nhận theo Điều lệ Appota.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

type ClassLike = { name: string; votesPerShare: number; liquidationPrefX: { toString(): string }; seniority: number; participating: boolean; notes: string | null };

function ClassFields({ c }: { c?: ClassLike }) {
  return (
    <>
      <Field label="Tên"><input name="name" required defaultValue={c?.name} className="field" /></Field>
      <Field label="Phiếu biểu quyết / CP"><input name="votesPerShare" type="number" min={0} defaultValue={c?.votesPerShare ?? 1} className="field num" /></Field>
      <Field label="Ưu tiên thanh lý (x lần vốn)"><input name="liquidationPrefX" type="number" step="0.01" min={0} defaultValue={c?.liquidationPrefX.toString() ?? "0"} className="field num" /></Field>
      <Field label="Thứ tự ưu tiên (cao = trước)"><input name="seniority" type="number" min={0} defaultValue={c?.seniority ?? 0} className="field num" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="participating" defaultChecked={c?.participating} /> Tham gia chia phần còn lại (participating)</label>
      <Field label="Ghi chú điều khoản" className="sm:col-span-2"><input name="notes" defaultValue={c?.notes ?? ""} className="field" /></Field>
    </>
  );
}

type RoundLike = {
  name: string; status: keyof typeof ROUND_STATUS; closeDate: Date | null; currency: string;
  preMoney: { toString(): string } | null; pricePerShare: { toString(): string } | null; targetAmount: { toString(): string } | null; notes: string | null;
};

function RoundFields({ r, seeMoney }: { r?: RoundLike; seeMoney: boolean }) {
  return (
    <>
      <Field label="Tên"><input name="name" required defaultValue={r?.name} className="field" /></Field>
      <Field label="Trạng thái">
        <select name="status" defaultValue={r?.status ?? "PLANNED"} className="field">
          {Object.entries(ROUND_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Ngày đóng vòng"><input type="date" name="closeDate" defaultValue={isoDate(r?.closeDate)} className="field" /></Field>
      <Field label="Tiền tệ">
        <select name="currency" defaultValue={r?.currency ?? "VND"} className="field">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      {seeMoney && (
        <>
          <Field label="Định giá trước vốn (pre-money)"><input name="preMoney" defaultValue={r?.preMoney?.toString() ?? ""} className="field num" /></Field>
          <Field label="Giá / cổ phần"><input name="pricePerShare" defaultValue={r?.pricePerShare?.toString() ?? ""} className="field num" /></Field>
          <Field label="Mục tiêu huy động"><input name="targetAmount" defaultValue={r?.targetAmount?.toString() ?? ""} className="field num" /></Field>
        </>
      )}
      <Field label="Ghi chú" className="sm:col-span-2"><input name="notes" defaultValue={r?.notes ?? ""} className="field" /></Field>
    </>
  );
}
