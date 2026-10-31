import { CalendarSection, DigestToggle, MfaSection, PasswordForm, ProfileForm, SessionsSection } from "@/components/settings/account";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("VIEWER", { allowMfaSetup: true });
  const sp = await searchParams;
  const [row, security, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, role: true, mfaEnabled: true, calendarToken: true, lastLoginAt: true, dailyDigest: true } }),
    getSetting("security"),
    db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, ip: true, userAgent: true, lastSeenAt: true, createdAt: true } }),
  ]);
  const mustSetUp = !row.mfaEnabled && security.requireMfa;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Your account" description={`${row.email} · ${ROLE_LABEL[row.role]}${row.lastLoginAt ? ` · last sign-in ${formatDateTime(row.lastLoginAt)}` : ""}`} />
      {mustSetUp || sp.setup === "mfa" ? (
        <Alert tone={mustSetUp ? "warning" : "accent"} title="Set up two-step sign-in" className="mb-4">
          {mustSetUp ? "Your workspace requires it before you can use the rest of the app. It takes about a minute with an authenticator app such as Microsoft Authenticator." : "Recommended for every account."}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Two-step sign-in" description="A 6-digit code from an authenticator app, asked for after your password." />
          <CardBody><MfaSection enabled={row.mfaEnabled} required={security.requireMfa} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Profile" />
          <CardBody><ProfileForm name={row.name} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" description="At least 12 characters. Changing it signs out your other devices." />
          <CardBody><PasswordForm /></CardBody>
        </Card>
        {row.role !== "VIEWER" ? (
          <Card>
            <CardHeader title="Morning email" description="Weekdays: replies and website inquiries since the last one, follow-ups due, emails to approve and renewals coming up. Nothing is sent on a day with nothing to do." />
            <CardBody><DigestToggle on={row.dailyDigest} /></CardBody>
          </Card>
        ) : null}
        <div id="calendar" className="scroll-mt-20">
          <Card>
            <CardHeader title="Calendar feed" description="Subscribe in Outlook or Google Calendar to see your callbacks, meetings and follow-ups. The link is private; anyone with it can see company names and follow-up times." />
            <CardBody><CalendarSection active={!!row.calendarToken} origin={process.env.APP_ORIGIN ?? ""} /></CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Signed-in devices" />
          <CardBody><SessionsSection sessions={sessions.map((s) => ({ id: s.id, current: s.id === user.sessionId, ip: s.ip, agent: s.userAgent, lastSeen: formatDateTime(s.lastSeenAt) }))} /></CardBody>
        </Card>
      </div>
    </div>
  );
}
