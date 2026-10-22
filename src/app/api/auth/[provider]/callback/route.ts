import { NextResponse, type NextRequest } from "next/server";
import { consumeOAuth, matchInternalUser } from "@/lib/auth/oauth";
import { googleExchange } from "@/lib/auth/google";
import { larkExchange } from "@/lib/auth/lark";
import { recordAttempt, tooManyFailures } from "@/lib/auth/rate-limit";
import type { LoginError } from "@/lib/auth/errors";
import { clientInfo } from "@/lib/request";
import { createSession, homeFor } from "@/lib/session";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/auth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const back = (error: LoginError) => NextResponse.redirect(new URL(`/login?error=${error}`, req.url));
  if (provider !== "google" && provider !== "lark") return back("provider");

  const { ip } = await clientInfo();
  if (await tooManyFailures(null, ip)) return back("rate_limited");

  const sp = req.nextUrl.searchParams;
  const st = await consumeOAuth(provider, sp.get("state"));
  const code = sp.get("code");
  if (!st || !code) {
    await recordAttempt({ email: null, ip, method: provider, ok: false, reason: "bad_state" });
    return back("bad_state");
  }

  let identity: { subject: string; email: string };
  try {
    identity =
      provider === "google"
        ? await googleExchange(code, st.verifier, st.nonce)
        : await larkExchange(code, st.verifier);
  } catch (e) {
    // Lý do chi tiết chỉ ghi log nội bộ, không trả về trình duyệt.
    const reason = (e instanceof Error ? e.message : "sso_error").slice(0, 200);
    await recordAttempt({ email: null, ip, method: provider, ok: false, reason });
    return back("sso_rejected");
  }

  const m = await matchInternalUser({ provider, ...identity, ip });
  if ("error" in m) return back(m.error);

  await createSession(m.user, provider);
  return NextResponse.redirect(new URL(st.next || homeFor(m.user.role), req.url));
}
