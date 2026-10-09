import { NextResponse, type NextRequest } from "next/server";
import { AUTH_BINDING_COOKIE, beginSignIn } from "@/lib/auth/entra";
import { config, secureCookies } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { clientIp } from "@/lib/http/ip";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await rateLimit(`signin:${clientIp(req)}`, 30, 300);
    const sp = req.nextUrl.searchParams;
    const prompt = sp.get("prompt") === "login" ? "login" : "select_account";
    const { url, binding, bindingMaxAge } = await beginSignIn({
      returnTo: sp.get("returnTo"),
      inviteToken: sp.get("invite"),
      prompt,
    });
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(AUTH_BINDING_COOKIE, binding, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/api/auth/callback",
      maxAge: bindingMaxAge,
    });
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    const code = err instanceof AppError ? err.code : "internal";
    return NextResponse.redirect(new URL(`/signin?error=${code}`, config().appOrigin), 303);
  }
}
