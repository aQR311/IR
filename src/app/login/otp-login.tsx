"use client";

import { useActionState } from "react";
import { requestOtpAction, verifyOtpAction } from "@/server/actions/auth";

export function OtpLogin() {
  const [sent, request, requesting] = useActionState(requestOtpAction, null);
  const [verified, verify, verifying] = useActionState(verifyOtpAction, null);
  const email = verified?.data?.email ?? sent?.data?.email;

  if (!email) {
    return (
      <form action={request} className="mt-3 grid gap-2">
        <input name="email" type="email" required autoComplete="email" placeholder="email@congty.com" className="field" aria-label="Email" />
        <button className="btn-ghost" disabled={requesting}>{requesting ? "Đang gửi…" : "Gửi mã đăng nhập"}</button>
        {sent && !sent.ok && <p className="text-xs text-bad">{sent.message}</p>}
      </form>
    );
  }

  return (
    <form action={verify} className="mt-3 grid gap-2">
      <p className="text-xs text-muted">{sent?.message}</p>
      <input type="hidden" name="email" value={email} />
      <input
        name="code"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        required
        autoComplete="one-time-code"
        placeholder="Mã 6 số"
        className="field num tracking-[0.4em]"
        aria-label="Mã OTP"
      />
      <button className="btn" disabled={verifying}>{verifying ? "Đang kiểm tra…" : "Đăng nhập"}</button>
      {verified && !verified.ok && <p className="text-xs text-bad">{verified.message}</p>}
    </form>
  );
}
