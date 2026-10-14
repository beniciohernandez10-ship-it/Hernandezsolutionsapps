import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/current";
import { entraConfigured, safeReturnTo } from "@/lib/auth/entra";
import { demoAllowed } from "@/lib/auth/demo";
import { DEMO_PERSONAS } from "@/lib/db/seed";
import { config } from "@/lib/config";
import { IconBack, IconMicrosoft } from "@/components/icons";
import { DemoSignIn } from "./demo";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid_request: "That sign-in link expired or was already used. Please start again.",
  token_rejected: "Microsoft sign-in could not be verified for this portal. If your organization is new to Hernandez Solutions, contact us to finish setup.",
  not_provisioned: "Your Microsoft account isn't connected to the IT Center yet. Ask your administrator or Hernandez Solutions for an invitation.",
  no_access: "Your account doesn't currently have access to any organization in the IT Center.",
  provider_error: "Microsoft sign-in was cancelled or failed. Please try again.",
  not_configured: "Microsoft sign-in hasn't been configured for this environment yet.",
  rate_limited: "Too many sign-in attempts. Please wait a few minutes and try again.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(sp.returnTo);
  if (await currentSession()) redirect(returnTo);
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : null;
  const showDemo = demoAllowed();
  return (
    <div className="auth-shell">
      <main className="card auth-card" id="main">
        <p className="eyebrow">Hernandez Solutions</p>
        <h1>IT Center</h1>
        <p className="muted">Sign in with your work Microsoft account to request help and follow your tickets.</p>
        {error && (
          <div className="alert alert-danger" role="alert">
            <div>
              <strong>We couldn't sign you in</strong>
              {error}
            </div>
          </div>
        )}
        <div className="stack">
          {entraConfigured() ? (
            <a className="btn btn-primary btn-block" href={`/api/auth/signin?returnTo=${encodeURIComponent(returnTo)}`}>
              <IconMicrosoft /> Sign in with Microsoft
            </a>
          ) : (
            <p className="alert alert-warning">
              <span>
                <strong>Microsoft sign-in isn&apos;t configured here.</strong>
                Set the Entra variables described in docs/microsoft-setup.md.
              </span>
            </p>
          )}
          {showDemo && <DemoSignIn personas={DEMO_PERSONAS} />}
          <p className="subtle">
            <Link href={config().websiteUrl}>
              <IconBack size={14} /> Back to thehernandezsolutions.com
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
