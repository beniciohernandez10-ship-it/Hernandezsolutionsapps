import { Plus } from "lucide-react";
import Link from "next/link";
import { EnrollmentControls } from "@/components/outreach/sequence-editor";
import { OutreachNav } from "@/components/outreach/subnav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { canAdmin, canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { ENROLLMENT_STATUS_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { db } from "@/lib/db";

export const metadata = { title: "Sequences" };

export default async function SequencesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const [sequences, enrollments] = await Promise.all([
    db.sequence.findMany({
      orderBy: { createdAt: "asc" },
      include: { steps: { orderBy: { order: "asc" }, include: { template: { select: { name: true } } } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
    }),
    db.enrollment.findMany({
      where: showAll ? {} : { status: { in: ["ACTIVE", "PAUSED"] } },
      include: { company: { select: { id: true, name: true } }, contact: { select: { name: true } }, sequence: { select: { name: true, _count: { select: { steps: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
  ]);
  return (
    <div>
      <PageHeader
        title="Sequences"
        description="A sequence drafts a first email and timed follow-ups. Each draft waits in the approval queue; a reply stops the sequence."
        actions={canAdmin(user.role) ? <Button asChild variant="primary"><Link href="/outreach/sequences/new"><Plus /> New sequence</Link></Button> : null}
      />
      <OutreachNav active="/outreach/sequences" />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {sequences.map((s) => (
          <Card key={s.id}>
            <CardHeader
              title={<span className="flex items-center gap-2">{s.name}{!s.active ? <Badge tone="warning">Off</Badge> : null}</span>}
              description={s.description ?? undefined}
              action={canAdmin(user.role) ? <Button asChild size="sm" variant="ghost"><Link href={`/outreach/sequences/${s.id}`}>Edit</Link></Button> : null}
            />
            <ol className="space-y-1 px-4 py-3 text-sm">
              {s.steps.map((st) => (
                <li key={st.id} className="flex gap-3">
                  <span className="w-24 shrink-0 text-muted">{st.order === 1 ? (st.delayDays ? `Day ${st.delayDays}` : "Right away") : `+${st.delayDays} day${st.delayDays === 1 ? "" : "s"}`}</span>
                  <span>{st.template?.name ?? (st.order === 1 ? "Industry first email" : `Follow-up ${st.order - 1} (built-in)`)}{st.order > 1 && st.sameThread ? <span className="text-muted"> · same thread</span> : null}</span>
                </li>
              ))}
            </ol>
            <p className="border-t border-border px-4 py-2 text-xs text-muted">{s._count.enrollments} active · follow-up delays count from when the previous email was sent</p>
          </Card>
        ))}
        {!sequences.length ? <EmptyState title="No sequences yet">Run the seed once to add the standard 4-email sequence, or create your own.</EmptyState> : null}
      </div>

      <Card>
        <CardHeader
          title={showAll ? "All enrollments" : "Active and paused"}
          action={<Link href={showAll ? "/outreach/sequences" : "/outreach/sequences?all=1"} className="text-xs text-accent hover:underline">{showAll ? "Show active only" : "Show finished too"}</Link>}
        />
        {enrollments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Prospect</th>
                  <th className="px-4 py-2 font-medium">Sequence</th>
                  <th className="px-4 py-2 font-medium">Progress</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Next draft</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-2"><Link href={`/leads/${e.company.id}`} className="font-medium hover:underline">{e.company.name}</Link><div className="text-xs text-muted">{e.contact?.name ? `${e.contact.name} · ` : ""}{e.toEmail}</div></td>
                    <td className="px-4 py-2">{e.sequence.name}</td>
                    <td className="px-4 py-2 tabular-nums">{e.currentStep} of {e.sequence._count.steps}</td>
                    <td className="px-4 py-2"><Badge tone={e.status === "ACTIVE" ? "accent" : e.status === "REPLIED" ? "success" : "neutral"}>{ENROLLMENT_STATUS_LABEL[e.status]}</Badge>{e.stopReason ? <div className="text-xs text-muted">{e.stopReason}</div> : null}</td>
                    <td className="px-4 py-2 text-muted">{e.nextStepDueAt ? formatDate(e.nextStepDueAt, { month: "short", day: "numeric" }) : e.status === "ACTIVE" ? "After the current email is sent" : "—"}</td>
                    <td className="px-4 py-2 text-right">{canWrite(user.role) ? <EnrollmentControls id={e.id} status={e.status} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">No prospects are in a sequence. Start one from a prospect&apos;s email page, or select prospects in the list and choose Add to sequence.</p>
        )}
      </Card>
    </div>
  );
}
