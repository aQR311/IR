import { NextResponse, type NextRequest } from "next/server";
import { googleEnabled, larkEnabled } from "@/lib/env";
import { beginOAuth } from "@/lib/auth/oauth";
import { googleAuthorizeUrl } from "@/lib/auth/google";
import { larkAuthorizeUrl } from "@/lib/auth/lark";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/auth/[provider]/start">) {
  const { provider } = await ctx.params;
  const next = req.nextUrl.searchParams.get("next") ?? "";
  if (provider === "google" && googleEnabled()) {
    const st = await beginOAuth("google", next);
    return NextResponse.redirect(googleAuthorizeUrl(st));
  }
  if (provider === "lark" && larkEnabled()) {
    const st = await beginOAuth("lark", next);
    return NextResponse.redirect(larkAuthorizeUrl(st));
  }
  return NextResponse.redirect(new URL("/login?error=provider", req.url));
}
