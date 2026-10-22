"use client";

import { startTransition, useActionState } from "react";
import type { ActionResult } from "@/components/action-form";

type Row = { line: number; label: string; detail: string; error?: string };
type Action = (prev: (ActionResult & { rows?: Row[] }) | null, fd: FormData) => Promise<ActionResult & { rows?: Row[] }>;

/** Chọn file → "Kiểm tra" (chỉ đọc, hiện bảng xem trước) → "Nhập" (chỉ chạy khi không có dòng lỗi). */
export function ImportForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  const rows = state?.rows ?? [];
  const errors = rows.filter((r) => r.error).length;
  return (
    // Gọi action thủ công thay vì <form action>: React 19 tự reset form sau action, làm mất file đã chọn
    // giữa bước "Kiểm tra" và "Nhập".
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <input type="file" name="file" accept=".csv,text/csv" required className="field" aria-label="File CSV" />
      <div className="flex flex-wrap gap-2">
        <button name="mode" value="preview" className="btn-ghost" disabled={pending}>{pending ? "Đang xử lý…" : "Kiểm tra"}</button>
        <button name="mode" value="commit" className="btn" disabled={pending || !state?.ok || rows.length === 0}>Nhập</button>
      </div>
      {state?.message && (
        <p role="status" className={`rounded-md px-2.5 py-1.5 text-xs ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{state.message}</p>
      )}
      {rows.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-md border border-line">
          <table className="tbl">
            <thead><tr><th>Dòng</th><th>Nội dung</th><th>Kết quả</th></tr></thead>
            <tbody>
              {(errors ? rows.filter((r) => r.error) : rows).map((r) => (
                <tr key={r.line}>
                  <td className="num text-muted">{r.line}</td>
                  <td><div className="font-medium">{r.label}</div><div className="text-xs text-muted">{r.detail}</div></td>
                  <td className={`text-xs ${r.error ? "text-bad" : "text-ok"}`}>{r.error ?? "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {errors > 0 && <p className="text-xs text-muted">Chỉ hiện các dòng lỗi. Sửa trong Excel, lưu lại CSV UTF-8 rồi chọn lại file.</p>}
    </form>
  );
}
