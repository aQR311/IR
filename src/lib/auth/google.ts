import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env";

// Google Workspace OIDC (authorization code + PKCE). Chỉ nhận tài khoản thuộc GOOGLE_ALLOWED_DOMAIN.
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const redirectUri = () => `${env().APP_URL}/api/auth/google/callback`;

export function googleAuthorizeUrl(p: { state: string; nonce: string; challenge: string }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    hd: env().GOOGLE_ALLOWED_DOMAIN, // chỉ gợi ý giao diện — vẫn kiểm tra lại claim `hd` bên dưới
    prompt: "select_account",
  }).toString();
  return u.toString();
}

export async function googleExchange(code: string, verifier: string, nonce: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google token lỗi ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google không trả id_token");

  const { payload } = await jwtVerify(id_token, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env().GOOGLE_CLIENT_ID,
  });
  const domain = env().GOOGLE_ALLOWED_DOMAIN.toLowerCase();
  const email = String(payload.email ?? "").toLowerCase();
  if (payload.nonce !== nonce) throw new Error("Sai nonce");
  if (payload.email_verified !== true) throw new Error("Email Google chưa xác minh");
  if (payload.hd !== domain || !email.endsWith(`@${domain}`)) {
    throw new Error("Chỉ chấp nhận tài khoản Google Workspace của công ty");
  }
  return { subject: String(payload.sub), email, name: String(payload.name ?? email) };
}
