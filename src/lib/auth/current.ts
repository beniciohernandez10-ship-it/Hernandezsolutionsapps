import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asSystem } from "../db";
import { loadPrincipal, type Principal } from "../authz";
import { readSession, sessionCookieName } from "./session";

/** Per-render lookup of the signed-in user for server components. */
export const currentSession = cache(async () => {
  const jar = await cookies();
  const session = await readSession(jar.get(sessionCookieName())?.value);
  if (!session) return null;
  const principal = await asSystem((tx) => loadPrincipal(tx, session.userId));
  if (!principal) return null;
  principal.sessionAuthTime = session.authTime;
  return { session, principal };
});

export async function requirePrincipal(returnTo?: string): Promise<{ principal: Principal; csrfToken: string }> {
  const s = await currentSession();
  if (!s) {
    const path = returnTo ?? (await headers()).get("x-itc-path") ?? "/portal";
    redirect(`/signin?returnTo=${encodeURIComponent(path)}`);
  }
  return { principal: s.principal, csrfToken: s.session.csrfToken };
}
