import { config } from "../config";

/**
 * Local demonstration sign-in is disabled unless DEMO_MODE=true, never in
 * production, and only when the portal origin is localhost, so persona
 * switching cannot be exposed on a public deployment.
 */
export function demoAllowed() {
  const c = config();
  if (!c.demoMode || c.isProduction) return false;
  const host = new URL(c.appOrigin).hostname;
  return host === "localhost" || host === "127.0.0.1";
}
