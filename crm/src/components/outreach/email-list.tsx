"use client";

import { Ban, Check, ChevronDown, ExternalLink, Mail, PencilLine, RefreshCw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { cancelEmailAction, deleteEmailAction, markSentAction, runSequencesAction, sendEmailAction, sendManyAction } from "@/app/(app)/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { EMAIL_STATUS_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface EmailRow {
  id: string;
  status: string;
  company: { id: string; name: string; doNotContact: boolean };
  contact: string | null;
  toEmail: string;
  subject: string;
  body: string;
  sequence: string | null;
  step: number | null;
  when: string;
  sentVia: string | null;
  error: string | null;
  placeholders: string[];
  mailto: string;
}

export function EmailList({ emails, tab, provider, canEdit }: { emails: EmailRow[]; tab: string; provider: "gmail" | "graph" | "manual"; canEdit: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState<string | null>(null);
  const many = useServerAction(sendManyAction);
  const runSeq = useServerAction(runSequencesAction);
  const sendable = tab === "queue" || tab === "drafts" || tab === "failed";
  const ready = emails.filter((e) => !e.placeholders.length && !e.company.doNotContact);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  React.useEffect(() => setSelected((s) => s.filter((id) => emails.some((e) => e.id === id))), [emails]);

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {sendable && provider !== "manual" && emails.length ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={selected.length > 0 && selected.length === ready.length}
                  onChange={(e) => setSelected(e.target.checked ? ready.map((r) => r.id) : [])}
                />
                Select all ready ({ready.length})
              </label>
              <Button
                variant="primary"
                disabled={!selected.length || many.pending}
                onClick={async () => {
                  if (!window.confirm(`Send ${selected.length} email${selected.length === 1 ? "" : "s"} now? Each goes out from your connected account.`)) return;
                  await many.run(selected);
                  setSelected([]);
                  router.refresh();
                }}
              >
                <Send /> {many.pending ? "Sending…" : `Approve & send ${selected.length || ""}`.trim()}
              </Button>
            </>
          ) : null}
          <Button variant="ghost" className="ml-auto" disabled={runSeq.pending} onClick={async () => { await runSeq.run(); router.refresh(); }}>
            <RefreshCw className={cn(runSeq.pending && "animate-spin")} /> Check for due follow-ups
          </Button>
          <Button asChild variant="secondary"><Link href="/outreach/compose"><PencilLine /> Write an email</Link></Button>
        </div>
      ) : null}

      {!emails.length ? (
        <EmptyState icon={<Mail />} title={tab === "queue" ? "Nothing waiting for approval" : "Nothing here"}>
          {tab === "queue" ? "Write an email from a prospect's profile, or add prospects to a sequence. Drafted emails wait here for you." : null}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {emails.map((e) => (
            <li key={e.id} className="rounded-lg border border-border bg-surface shadow-xs">
              <div className="flex items-start gap-3 px-3 py-2.5">
                {sendable && canEdit && provider !== "manual" ? (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--accent)]"
                    checked={selected.includes(e.id)}
                    disabled={!!e.placeholders.length || e.company.doNotContact}
                    onChange={() => toggle(e.id)}
                    aria-label={`Select email to ${e.company.name}`}
                  />
                ) : null}
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.company.name}</span>
                    <span className="text-sm text-muted">{e.contact ? `${e.contact} · ` : ""}{e.toEmail}</span>
                    {e.sequence ? <Badge tone="outline">{e.sequence} · email {e.step}</Badge> : null}
                    {e.status !== "PENDING_APPROVAL" ? <Badge tone={e.status === "SENT" ? "success" : e.status === "FAILED" ? "danger" : "neutral"}>{EMAIL_STATUS_LABEL[e.status]}{e.sentVia === "manual" ? " by hand" : ""}</Badge> : null}
                    {e.placeholders.length ? <Badge tone="warning">Needs editing</Badge> : null}
                    {e.company.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm">{e.subject}</p>
                  <p className="text-xs text-subtle">{e.when}</p>
                </button>
                <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform", open === e.id && "rotate-180")} />
              </div>
              {open === e.id ? <EmailDetail email={e} provider={provider} canEdit={canEdit} onChanged={() => router.refresh()} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailDetail({ email: e, provider, canEdit, onChanged }: { email: EmailRow; provider: string; canEdit: boolean; onChanged: () => void }) {
  const send = useServerAction(sendEmailAction);
  const mark = useServerAction(markSentAction);
  const cancel = useServerAction(cancelEmailAction);
  const del = useServerAction(deleteEmailAction);
  const unsent = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "FAILED"].includes(e.status);
  return (
    <div className="border-t border-border px-3 py-3">
      {e.error ? <p className="mb-2 rounded bg-danger-soft px-2 py-1 text-sm text-danger">{e.error}</p> : null}
      {e.placeholders.length ? <p className="mb-2 rounded bg-warning-soft px-2 py-1 text-sm text-warning">Fill in or remove before sending: {e.placeholders.join(", ")}</p> : null}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-sans text-sm leading-6">{e.body}</pre>
      <p className="mt-1 text-xs text-subtle">Your signature, mailing address and opt-out line are added when it&apos;s sent.</p>
      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {unsent && provider !== "manual" ? (
            <Button variant="primary" disabled={send.pending || !!e.placeholders.length || e.company.doNotContact} onClick={async () => { const r = await send.run(e.id); if (r?.ok) onChanged(); }}>
              <Send /> {send.pending ? "Sending…" : e.status === "FAILED" ? "Try again" : "Approve & send"}
            </Button>
          ) : null}
          {unsent ? (
            <>
              <Button asChild variant="secondary"><Link href={`/outreach/compose?email=${e.id}`}><PencilLine /> Edit</Link></Button>
              <Button asChild variant={provider === "manual" ? "primary" : "ghost"}><a href={e.mailto}><ExternalLink /> Open in my mail app</a></Button>
              <Button variant="ghost" disabled={mark.pending} onClick={async () => { if (window.confirm("Mark this email as sent? Only do this after you've sent it from your mail app.")) { const r = await mark.run(e.id); if (r?.ok) onChanged(); } }}>
                <Check /> Mark sent
              </Button>
              <Button variant="danger-ghost" disabled={cancel.pending} onClick={async () => { const r = await cancel.run(e.id); if (r?.ok) onChanged(); }}>
                <Ban /> Cancel
              </Button>
            </>
          ) : null}
          {["DRAFT", "CANCELLED", "FAILED"].includes(e.status) ? (
            <Button variant="danger-ghost" disabled={del.pending} onClick={async () => { if (window.confirm("Delete this email?")) { const r = await del.run(e.id); if (r?.ok) onChanged(); } }}>
              <Trash2 /> Delete
            </Button>
          ) : null}
          <Button asChild variant="ghost" className="ml-auto"><Link href={`/leads/${e.company.id}`}>Open prospect</Link></Button>
        </div>
      ) : null}
    </div>
  );
}
