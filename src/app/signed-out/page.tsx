import Link from "next/link";
import { config } from "@/lib/config";

export const metadata = { title: "Signed out" };

export default function SignedOut() {
  return (
    <div className="auth-shell">
      <main className="card auth-card" id="main">
        <p className="eyebrow">Signed out</p>
        <h1>You&apos;re signed out</h1>
        <p className="muted">Your IT Center session has ended on this device.</p>
        <div className="row">
          <Link className="btn btn-primary" href={config().websiteUrl}>Return to thehernandezsolutions.com</Link>
          <Link className="btn" href="/signin">Sign in again</Link>
        </div>
      </main>
    </div>
  );
}
