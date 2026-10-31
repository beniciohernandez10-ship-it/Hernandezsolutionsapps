import { NextResponse } from "next/server";
import { ingestWebsiteLead, verifySignature, websitePayload } from "@/lib/inbound/website";

export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

/** Called by the website for each form submission. Authenticated by a signature, before anything is parsed. */
export async function POST(req: Request) {
  const secret = process.env.WEBSITE_LEAD_SECRET;
  // Not set up yet: the website keeps the lead in its own database and reports the failure.
  if (!secret) return NextResponse.json({ error: "Website leads aren't set up" }, { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const body = await req.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  if (!verifySignature(body, req.headers.get("x-timestamp"), req.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  const parsed = websitePayload.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid lead" }, { status: 422 });
  const result = await ingestWebsiteLead(parsed.data.lead);
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
