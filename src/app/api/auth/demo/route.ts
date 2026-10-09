import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asSystem } from "@/lib/db";
import { demoAllowed } from "@/lib/auth/demo";
import { createSession, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { auditAuth } from "@/lib/auth/entra";
import { DEMO_PERSONAS } from "@/lib/db/seed";
import { checkOrigin, jsonError, readJson } from "@/lib/http/api";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Local demonstration sign-in; see demoAllowed() for the guard rails. */
export async function POST(req: NextRequest) {
  try {
    if (!demoAllowed()) throw new AppError(404, "not_found", "Not found.");
    if (!checkOrigin(req)) throw new AppError(403, "csrf_failed", "This request did not come from the portal.");
    const { personaId } = z.object({ personaId: z.uuid() }).parse(await readJson(req));
    if (!DEMO_PERSONAS.some((p) => p.id === personaId)) throw new AppError(404, "not_found", "Unknown demo persona.");
    const ok = await asSystem((tx) => tx.query("select 1 from users where id = $1 and is_demo and status = 'active'", [personaId]));
    if (!ok.rows[0]) throw new AppError(404, "not_found", "Demo data is not seeded. Run npm run db:seed.");
    const s = await createSession(personaId, "demo");
    await auditAuth(personaId, "auth.signin", "success", { method: "demo" });
    const res = NextResponse.json({ redirect: "/portal" }, { headers: { "cache-control": "no-store" } });
    res.cookies.set(sessionCookieName(), s.token, sessionCookieOptions(s.maxAge));
    return res;
  } catch (err) {
    return jsonError(err, "demo");
  }
}
