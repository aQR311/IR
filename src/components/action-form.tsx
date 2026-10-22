"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { ok: boolean; message: string; data?: Record<string, string> };
type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
  render,
}: {
  action: Action;
  children?: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  render?: (state: ActionResult | null) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {render?.(state)}
      {state?.message && (
        <p
          role="status"
          className={`mt-2 rounded-md px-2.5 py-1.5 text-xs ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, variant = "btn" }: { children: ReactNode; variant?: "btn" | "btn-ghost" | "btn-danger" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={variant} disabled={pending}>
      {pending ? "Đang xử lý…" : children}
    </button>
  );
}
