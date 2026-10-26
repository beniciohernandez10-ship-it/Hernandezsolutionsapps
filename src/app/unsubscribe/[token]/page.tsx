import Link from "next/link";
import { lookupUnsubscribe, type UnsubscribeAction } from "@/lib/notify/unsubscribe";

export const metadata = { title: "Email preferences", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> };

function Action({ token, action, label, primary }: { token: string; action: UnsubscribeAction; label: string; primary?: boolean }) {
  return (
    <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`}>
      <input type="hidden" name="action" value={action} />
      <button type="submit" className={primary ? "btn btn-primary" : "btn"}>{label}</button>
    </form>
  );
}

const Settings = () => (
  <p className="subtle">
    You can change any email setting after signing in, under <Link href="/portal/settings">Settings</Link>. Notifications inside the IT Center
    aren&apos;t affected.
  </p>
);

export default async function UnsubscribePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { done } = await searchParams;
  const info = await lookupUnsubscribe(token);

  if (!info) {
    return (
      <div className="auth-shell">
        <main className="card auth-card" id="main">
          <p className="eyebrow">Email preferences</p>
          <h1>This link has expired</h1>
          <p className="muted">Unsubscribe links work for a year. Sign in to change which emails you get.</p>
          <div className="row">
            <Link className="btn btn-primary" href="/portal/settings">Open email settings</Link>
          </div>
        </main>
      </div>
    );
  }

  const name = `“${info.label}”`;
  let heading: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;
  if (!info.allOn) {
    heading = "All IT Center email is off";
    body = <p className="muted">We won&apos;t email {info.email} about requests anymore.</p>;
    actions = <Action token={token} action="undo-all" label="Turn email back on" />;
  } else if (!info.categoryOn) {
    heading = done === "category" ? "You're unsubscribed" : `${info.label} emails are off`;
    body = <p className="muted">We won&apos;t email {info.email} about {name} anymore. Other IT Center emails still arrive.</p>;
    actions = (
      <>
        <Action token={token} action="all" label="Stop all IT Center email" />
        <Action token={token} action="undo-category" label="Undo" />
      </>
    );
  } else {
    heading = done?.startsWith("undo-") ? "Email is back on" : `Unsubscribe from ${name}?`;
    body = (
      <p className="muted">
        {done?.startsWith("undo-") ? `${info.email} will get ${name} emails again.` : `${info.email} will stop getting ${name} emails from the Hernandez Solutions IT Center.`}
      </p>
    );
    actions = (
      <>
        {!done?.startsWith("undo-") && <Action token={token} action="category" label="Unsubscribe" primary />}
        <Action token={token} action="all" label="Stop all IT Center email" />
      </>
    );
  }

  return (
    <div className="auth-shell">
      <main className="card auth-card stack" id="main">
        <p className="eyebrow">Email preferences</p>
        <h1>{heading}</h1>
        {body}
        <div className="row">{actions}</div>
        <Settings />
      </main>
    </div>
  );
}
