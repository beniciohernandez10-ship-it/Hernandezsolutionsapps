import { lookupUnsubscribe } from "@/lib/optout";

export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Public page behind the link in sales email. It asks first, because mail scanners open links. */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await lookupUnsubscribe(token);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        {!info ? (
          <>
            <h1 className="mb-2 text-lg font-semibold">This link isn&apos;t valid</h1>
            <p className="text-sm text-muted">It may be incomplete. You can also reply to the email and ask to be removed.</p>
          </>
        ) : info.done ? (
          <>
            <h1 className="mb-2 text-lg font-semibold">You&apos;re unsubscribed</h1>
            <p className="text-sm text-muted">{info.company} won&apos;t send more sales email to {info.email}.</p>
          </>
        ) : (
          <form method="post" action={`/api/unsubscribe/${token}`}>
            <input type="hidden" name="from" value="page" />
            <h1 className="mb-2 text-lg font-semibold">Unsubscribe?</h1>
            <p className="mb-4 text-sm text-muted">Stop sales email from {info.company} to {info.email}.</p>
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Unsubscribe</button>
          </form>
        )}
      </div>
    </main>
  );
}
