import type { Investor } from "@prisma/client";
import { Field } from "@/components/ui";
import { CATEGORY_LABEL, STAGE_LABEL } from "@/lib/format";

const MANUAL_STAGES = ["LEAD", "CONTACTED", "NDA", "DUE_DILIGENCE", "TERM_SHEET", "COMMITTED", "DROPPED"];

/** Trường hồ sơ NĐT dùng chung cho form tạo & sửa. */
export function InvestorFields({
  inv,
  owners,
  withStage,
}: {
  inv?: Partial<Investor>;
  owners: { id: string; name: string }[];
  withStage?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Tên nhà đầu tư / pháp nhân *" className="sm:col-span-2">
        <input name="name" required defaultValue={inv?.name} className="field" />
      </Field>
      <Field label="Loại">
        <select name="type" defaultValue={inv?.type ?? "ORGANIZATION"} className="field">
          <option value="ORGANIZATION">Tổ chức</option>
          <option value="INDIVIDUAL">Cá nhân</option>
        </select>
      </Field>
      <Field label="Nhóm">
        <select name="category" defaultValue={inv?.category ?? "VC"} className="field">
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      {withStage && (
        <Field label="Trạng thái ban đầu">
          <select name="stage" defaultValue="LEAD" className="field">
            {MANUAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </Field>
      )}
      <Field label="Quốc gia (mã ISO 2 chữ)">
        <input name="country" defaultValue={inv?.country ?? "VN"} maxLength={2} className="field uppercase" />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:mt-5">
        <input type="checkbox" name="isForeign" defaultChecked={inv?.isForeign} /> Nhà đầu tư nước ngoài
      </label>
      <Field label="Email nhận thông báo chính thức">
        <input name="email" type="email" defaultValue={inv?.email ?? ""} className="field" />
      </Field>
      <Field label="Điện thoại">
        <input name="phone" defaultValue={inv?.phone ?? ""} className="field" />
      </Field>
      <Field label="Mã số thuế / ĐKKD">
        <input name="taxCode" defaultValue={inv?.taxCode ?? ""} className="field" />
      </Field>
      <Field label="Phụ trách IR">
        <select name="irOwnerId" defaultValue={inv?.irOwnerId ?? ""} className="field">
          <option value="">— Chưa phân công —</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <Field label="Địa chỉ" className="sm:col-span-2">
        <input name="address" defaultValue={inv?.address ?? ""} className="field" />
      </Field>
      <Field label="Ghi chú" className="sm:col-span-2">
        <textarea name="notes" rows={3} defaultValue={inv?.notes ?? ""} className="field" />
      </Field>
    </div>
  );
}
