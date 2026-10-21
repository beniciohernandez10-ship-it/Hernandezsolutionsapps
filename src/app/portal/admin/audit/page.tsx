import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { auditStatus } from "@/lib/audit/store";
import { PageTransition } from "@/components/page-transition";
import { IconAlert, IconBack, IconCheck } from "@/components/icons";
import { Time } from "@/components/time";
import { CheckNow } from "./check";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const { principal } = await requirePrincipal("/portal/admin/audit");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Audit log</h1>
        <p className="muted">Only platform operators can see the audit log status.</p>
      </PageTransition>
    );
  }
  const s = await auditStatus(principal);
  return (
    <PageTransition>
      <p>
        <Link href="/portal/admin" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Administration
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">Platform operator</p>
          <h1>Audit log</h1>
        </div>
      </div>
      <p className="subtle">
        Every sign-in, permission change, denied request and administrative action is recorded. A copy of each record goes to a separate,
        append-only database that the portal can add to but never read, change or delete. Each record is chained to the one before it with a
        SHA-256 hash, so a changed or missing record is detected.
      </p>

      {!s.configured ? (
        <div className="alert alert-warning">
          <IconAlert />
          <div>
            <strong>Off-site copy not set up</strong>
            Records are kept in the portal database only. Follow docs/audit-log.md to create the audit database; {s.pending} record(s) will be
            sent when it&apos;s connected.
          </div>
        </div>
      ) : s.lastVerifyOk === false ? (
        <div className="alert alert-danger" role="alert">
          <IconAlert />
          <div>
            <strong>Integrity check failed</strong>
            {s.lastVerifyNote} Treat this as a security incident: don&apos;t change either database, and review access to both.
          </div>
        </div>
      ) : s.lastError ? (
        <div className="alert alert-warning" role="alert">
          <IconAlert />
          <div>
            <strong>Sending is failing</strong>
            {s.lastError} Records wait safely in the portal database and are sent once this is fixed.
          </div>
        </div>
      ) : (
        <div className="alert alert-success" role="status">
          <IconCheck />
          <div>
            <strong>Off-site copy is up to date</strong>
            {s.pending === 0 ? "Every record has been sent." : `${s.pending} record(s) waiting to be sent.`}
          </div>
        </div>
      )}

      <section className="card stack">
        <dl className="kv">
          <dt>Records in the off-site store</dt>
          <dd>{s.storeRecords ?? "None yet"}</dd>
          <dt>Waiting to be sent</dt>
          <dd>
            {s.pending}
            {s.oldestPendingAt && <span className="subtle"> · oldest <Time iso={s.oldestPendingAt} /></span>}
          </dd>
          <dt>Last sent</dt>
          <dd>{s.lastShippedAt ? <Time iso={s.lastShippedAt} mode="absolute" /> : "Never"}</dd>
          <dt>Last integrity check</dt>
          <dd>
            {s.lastVerifiedAt ? (
              <>
                <Time iso={s.lastVerifiedAt} mode="absolute" /> · {s.lastVerifyOk ? "intact" : "failed"}
              </>
            ) : (
              "Not yet run"
            )}
          </dd>
          {s.lastErrorAt && (
            <>
              <dt>Last send error</dt>
              <dd><Time iso={s.lastErrorAt} mode="absolute" /></dd>
            </>
          )}
        </dl>
        <p className="subtle">Events are sent within seconds of each change, and the chain is checked automatically every day.</p>
        {s.configured && <CheckNow />}
      </section>
    </PageTransition>
  );
}
