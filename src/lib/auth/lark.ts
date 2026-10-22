import "server-only";
import { env } from "../env";

// Lark Suite OAuth (authorization code + PKCE). Chỉ nhận user thuộc tenant Appota (LARK_TENANT_KEY).
// Endpoint theo Lark Open Platform; base URL cấu hình được (Lark Suite / Feishu).
const redirectUri = () => `${env().APP_URL}/api/auth/lark/callback`;

export function larkAuthorizeUrl(p: { state: string; challenge: string }) {
  const u = new URL("/open-apis/authen/v1/authorize", env().LARK_ACCOUNTS_BASE);
  u.search = new URLSearchParams({
    client_id: env().LARK_APP_ID,
    redirect_uri: redirectUri(),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

type LarkUserInfo = {
  open_id: string;
  tenant_key: string;
  name?: string;
  email?: string;
  enterprise_email?: string;
};

export async function larkExchange(code: string, verifier: string) {
  const tokenRes = await fetch(new URL("/open-apis/authen/v2/oauth/token", env().LARK_OPEN_BASE), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env().LARK_APP_ID,
      client_secret: env().LARK_APP_SECRET,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  const token = (await tokenRes.json()) as { code?: number; access_token?: string };
  if (!tokenRes.ok || token.code !== 0 || !token.access_token) {
    throw new Error(`Lark token lỗi (${token.code ?? tokenRes.status})`);
  }

  const infoRes = await fetch(new URL("/open-apis/authen/v1/user_info", env().LARK_OPEN_BASE), {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  const info = (await infoRes.json()) as { code?: number; data?: LarkUserInfo };
  if (!infoRes.ok || info.code !== 0 || !info.data) throw new Error("Không lấy được thông tin user Lark");

  const d = info.data;
  if (d.tenant_key !== env().LARK_TENANT_KEY) throw new Error("Tài khoản Lark không thuộc tổ chức Appota");
  const email = (d.enterprise_email || d.email || "").toLowerCase();
  if (!email) throw new Error("Tài khoản Lark chưa có email doanh nghiệp");
  return { subject: d.open_id, email, name: d.name ?? email };
}
