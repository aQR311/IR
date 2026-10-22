"use client";

import { useActionState, useEffect, useState } from "react";
import { revealKycAction } from "@/server/actions/investors";

type Result = Awaited<ReturnType<typeof revealKycAction>>;

/** Hiển thị dạng che; bấm "Hiện" mới giải mã trên server (có ghi audit). Tự che lại sau 30 giây. */
export function KycReveal({ investorId, field, present }: { investorId: string; field: "idNumber" | "bankAccount"; present: boolean }) {
  const [state, action, pending] = useActionState(revealKycAction, null);
  // Kết quả nào đã bị che lại: so sánh theo tham chiếu, mỗi lần bấm "Hiện" là một kết quả mới.
  const [hidden, setHidden] = useState<Result | null>(null);
  const shown = state?.ok && state !== hidden ? state.data?.value : undefined;

  useEffect(() => {
    if (!state?.ok) return;
    const t = setTimeout(() => setHidden(state), 30_000);
    return () => clearTimeout(t);
  }, [state]);

  if (!present) return <span className="text-muted">Chưa có</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="investorId" value={investorId} />
      <input type="hidden" name="field" value={field} />
      <span className="num font-mono text-sm">{shown ?? "••••••••••"}</span>
      {shown ? (
        <button type="button" className="text-xs text-accent underline" onClick={() => setHidden(state)}>Che</button>
      ) : (
        <button className="text-xs text-accent underline" disabled={pending}>{pending ? "…" : "Hiện"}</button>
      )}
      {state && !state.ok && <span className="w-full text-xs text-bad">{state.message}</span>}
    </form>
  );
}
