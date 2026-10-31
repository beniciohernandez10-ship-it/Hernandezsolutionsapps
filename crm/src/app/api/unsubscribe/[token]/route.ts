import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/optout";

export const dynamic = "force-dynamic";

/**
 * A mail app's one-click unsubscribe (RFC 8058) or the button on the page.
 * Only POST acts: mail scanners open links, and that must not opt anyone out.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ok = await unsubscribeByToken(token);
  if (!ok) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  if (form?.get("from") === "page") return NextResponse.redirect(new URL(`/unsubscribe/${token}`, process.env.APP_ORIGIN ?? req.url), 303);
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/unsubscribe/${token}`, process.env.APP_ORIGIN ?? req.url), 303);
}
