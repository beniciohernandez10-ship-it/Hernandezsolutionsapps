import { Download } from "lucide-react";
import { CheckInboxButton, RemoveSuppression } from "@/components/settings/inbound";
import { OutreachSettingsForm, RestoreForm, SalesSettingsForm, ScoringForm, SecurityForm, UserAdmin } from "@/components/settings/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { canAdmin, hasRole } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { INDUSTRIES, REGIONS } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { PROVIDER_LABEL, mailProvider, senderAddress } from "@/lib/mail";
import { researchConfigured } from "@/lib/research";
import { SCORING_FACTORS, weightsOf } from "@/lib/scoring";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Settings" };

const SECTIONS = [
  { id: "sales", label: "Pricing & calls" },
  { id: "outreach", label: "Outreach" },
  { id: "scoring", label: "Lead scoring" },
  { id: "users", label: "Users" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Connections" },
  { id: "backup", label: "Backup" },
  { id: "audit", label: "Audit log" },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const admin = canAdmin(user.role);
  const owner = hasRole(user.role, "OWNER");
  const [inboxSync, suppressions, suppressionCount, sales, outreach, scoring, security, users, logs] = await Promise.all([
    getSetting("inboxSync"),
    db.emailSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.emailSuppression.count(),
    getSetting("sales"),
    getSetting("outreach"),
    getSetting("scoring"),
    getSetting("security"),
    admin ? db.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, active: true, mfaEnabled: true, lastLoginAt: true } }) : [],
    admin ? db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 150, include: { user: { select: { name: true } } } }) : [],
  ]);
  const provider = mailProvider();
  const integrations = [
    { name: "Email sending", status: provider === "manual" ? "Not connected" : `${PROVIDER_LABEL[provider]} · ${senderAddress()}`, ok: provider !== "manual", how: "GMAIL_USER and GMAIL_APP_PASSWORD (or the MS_* values for Microsoft 365) in Vercel environment variables." },
    {
      name: "Reply and bounce detection",
      status: provider === "manual" ? "Needs a connected mailbox" : inboxSync.lastError ? "Can't read the mailbox" : inboxSync.lastSuccessAt ? `Last checked ${formatDateTime(inboxSync.lastSuccessAt)}` : "Not checked yet",
      ok: provider !== "manual" && !inboxSync.lastError,
      how: inboxSync.lastError ?? "GMAIL_USER and GMAIL_APP_PASSWORD. Microsoft 365 also needs the Mail.Read application permission.",
    },
    {
      name: "Website inquiries",
      status: process.env.WEBSITE_LEAD_SECRET ? "Ready to receive" : "Not connected",
      ok: !!process.env.WEBSITE_LEAD_SECRET,
      how: "WEBSITE_LEAD_SECRET here, and the same value as CRM_WEBHOOK_SECRET on the website, with CRM_WEBHOOK_URL pointing at /api/inbound/website-lead.",
    },
    { name: "Research assistant", status: researchConfigured() ? "Connected" : "Not connected", ok: researchConfigured(), how: "ANTHROPIC_API_KEY in Vercel environment variables." },
    { name: "Daily jobs", status: process.env.CRON_SECRET ? "Scheduled daily" : "CRON_SECRET missing", ok: !!process.env.CRON_SECRET, how: "CRON_SECRET in Vercel; the schedule is in vercel.json." },
    { name: "Encryption key", status: process.env.APP_ENCRYPTION_KEY ? "Set" : "Missing", ok: !!process.env.APP_ENCRYPTION_KEY, how: "APP_ENCRYPTION_KEY (32 random bytes, base64)." },
  ];

  return (
    <div>
      <PageHeader title="Settings" description={admin ? "Workspace settings. Changes are recorded in the audit log." : "Only admins can change these settings."} />
      <nav className="mb-5 flex gap-1 overflow-x-auto scrollbar-thin" aria-label="Settings sections">
        {SECTIONS.filter((s) => admin || ["sales", "outreach", "integrations"].includes(s.id)).map((s) => (
          <a key={s.id} href={`#${s.id}`} className="whitespace-nowrap rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2">{s.label}</a>
        ))}
      </nav>
      <div className="flex max-w-4xl flex-col gap-4">
        <section id="sales" className="scroll-mt-20">
          <Card>
            <CardHeader title="Pricing & calls" description="Default price is used for every estimate unless a deal has custom pricing." />
            <CardBody><SalesSettingsForm values={sales} disabled={!admin} /></CardBody>
          </Card>
        </section>
        <section id="outreach" className="scroll-mt-20">
          <Card>
            <CardHeader title="Outreach" description="Added to every email. The mailing address is required by CAN-SPAM; sending is blocked until it's set." />
            <CardBody><OutreachSettingsForm values={outreach} disabled={!admin} /></CardBody>
          </Card>
          <Card className="mt-4">
            <CardHeader
              title={`Opted out or bounced (${suppressionCount})`}
              description="These addresses can't get sales email, even if they're imported again. Only remove one if the person asked you to."
            />
            <CardBody>
              {suppressions.length === 0 ? (
                <p className="text-sm text-muted">None yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {suppressions.map((s) => (
                    <li key={s.email} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {s.email} <span className="text-xs text-muted">· {s.reason === "bounce" ? "bounced" : s.reason === "reply" ? "replied to opt out" : "unsubscribe link"} · {formatDateTime(s.createdAt)}</span>
                      </span>
                      {admin ? <RemoveSuppression email={s.email} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>
        {admin ? (
          <>
            <section id="scoring" className="scroll-mt-20">
              <Card>
                <CardHeader title="Lead scoring" description="Weights must total 100. Saving re-scores every prospect." />
                <CardBody>
                  <ScoringForm
                    factors={SCORING_FACTORS.map((f) => ({ key: f.key, label: f.label }))}
                    weights={weightsOf(scoring)}
                    coreRegions={scoring.coreRegions}
                    regulatedIndustries={scoring.regulatedIndustries}
                    regions={REGIONS}
                    industries={INDUSTRIES}
                  />
                </CardBody>
              </Card>
            </section>
            <section id="users" className="scroll-mt-20">
              <Card>
                <CardHeader title="Users" description="Owner: everything. Admin: everything except owners, security and restore. Sales: work leads. Viewer: read-only." />
                <CardBody>
                  <UserAdmin
                    users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : null }))}
                    currentUserId={user.id}
                    isOwner={owner}
                  />
                </CardBody>
              </Card>
            </section>
            <section id="security" className="scroll-mt-20">
              <Card>
                <CardHeader title="Security" />
                <CardBody>
                  <SecurityForm values={security} disabled={!owner} />
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">
                    <li>Passwords are hashed with bcrypt; two-step sign-in secrets are encrypted with your APP_ENCRYPTION_KEY.</li>
                    <li>Accounts lock for 15 minutes after 8 failed sign-ins; sign-in, two-step, import and research are rate-limited.</li>
                    <li>Never store client passwords, MFA codes or app secrets in notes or client records.</li>
                  </ul>
                </CardBody>
              </Card>
            </section>
          </>
        ) : null}
        <section id="integrations" className="scroll-mt-20">
          <Card>
            <CardHeader
              title="Connections"
              description="Values live in Vercel environment variables, never in the app. Only their status is shown here."
              action={provider !== "manual" ? <CheckInboxButton /> : null}
            />
            <CardBody>
              <dl>
                {integrations.map((i) => (
                  <KeyValue key={i.name} label={i.name}>
                    <Badge tone={i.ok ? "success" : "warning"}>{i.status}</Badge>
                    {!i.ok ? <p className="mt-1 text-xs text-muted">Set {i.how}</p> : null}
                  </KeyValue>
                ))}
              </dl>
            </CardBody>
          </Card>
        </section>
        {admin ? (
          <>
            <section id="backup" className="scroll-mt-20">
              <Card>
                <CardHeader title="Backup & restore" description="Backups include prospects, contacts, history, emails, templates, clients and settings. They never include passwords, two-step secrets or sessions." />
                <CardBody className="flex flex-col gap-4">
                  {owner ? (
                    <>
                      <Button asChild variant="secondary" className="self-start"><a href="/api/backup"><Download /> Download backup</a></Button>
                      <RestoreForm />
                    </>
                  ) : (
                    <p className="text-sm text-muted">Only an owner can download or restore backups.</p>
                  )}
                  <p className="text-xs text-muted">Your Neon database also keeps its own point-in-time history; see the setup guide.</p>
                </CardBody>
              </Card>
            </section>
            <section id="audit" className="scroll-mt-20">
              <Card>
                <CardHeader title="Audit log" description="Most recent 150 events." />
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface-2 text-muted"><tr><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Who</th><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">IP</th></tr></thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id} className="border-t border-border">
                          <td className="whitespace-nowrap px-4 py-1.5">{formatDateTime(l.createdAt)}</td>
                          <td className="px-4 py-1.5">{l.user?.name ?? "System"}</td>
                          <td className="px-4 py-1.5"><code>{l.action}</code>{l.entity ? <span className="text-muted"> · {l.entity}</span> : null}</td>
                          <td className="px-4 py-1.5 text-muted">{l.ip ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
