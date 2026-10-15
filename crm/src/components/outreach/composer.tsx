"use client";

import { ExternalLink, ListPlus, Save, Send, Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { enrollAction, saveEmailAction, sendEmailAction } from "@/app/(app)/outreach/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useServerAction } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { MERGE_FIELDS, firstNameOf, renderTemplate, unresolvedPlaceholders } from "@/lib/templates";

interface Recipient { contactId: string | null; name: string; title: string | null; email: string; status: string }
interface Tpl { id: string; name: string; industries: string[]; subject: string; body: string }

export function Composer(props: {
  company: { id: string; name: string; city: string | null; industry: string; industryLabel: string; personalNote: string | null; doNotContact: boolean; contactFormUrl: string | null };
  recipients: Recipient[];
  contactsWithoutEmail: string[];
  templates: Tpl[];
  suggestedTemplateId: string | null;
  sender: { senderName: string; senderCompany: string; website: string; senderPhone: string };
  footer: string;
  sequences: { id: string; name: string; steps: number }[];
  activeSequence: string | null;
  existing: { id: string; contactId: string | null; toEmail: string; subject: string; body: string; templateId: string | null; status: string } | null;
  initialContactId: string | null;
  provider: "gmail" | "graph" | "manual";
  canEdit: boolean;
}) {
  const { company, recipients, templates, existing } = props;
  const router = useRouter();
  const initialRecipient =
    (existing && recipients.find((r) => r.email === existing.toEmail)) ??
    recipients.find((r) => r.contactId && r.contactId === props.initialContactId) ??
    recipients[0] ??
    null;
  const [recipientKey, setRecipientKey] = React.useState(initialRecipient ? initialRecipient.email : existing?.toEmail ? "custom" : "");
  const [customTo, setCustomTo] = React.useState(existing && !initialRecipient ? existing.toEmail : "");
  const recipient = recipients.find((r) => r.email === recipientKey) ?? null;
  const toEmail = recipientKey === "custom" ? customTo.trim() : recipient?.email ?? "";
  const contactId = recipientKey === "custom" ? existing?.contactId ?? null : recipient?.contactId ?? null;

  const [templateId, setTemplateId] = React.useState(existing?.templateId ?? props.suggestedTemplateId ?? "");
  const merge = React.useCallback(
    (r: Recipient | null) => ({
      firstName: r?.contactId ? firstNameOf(r.name) : "",
      contactName: r?.contactId ? r.name : "",
      contactTitle: r?.title ?? "",
      companyName: company.name,
      city: company.city ?? "",
      industry: company.industryLabel,
      personalNote: company.personalNote ?? "",
      ...props.sender,
    }),
    [company, props.sender],
  );
  const renderWith = React.useCallback(
    (tplId: string, r: Recipient | null) => {
      const t = templates.find((x) => x.id === tplId);
      if (!t) return { subject: "", body: "" };
      const data = merge(r);
      return { subject: renderTemplate(t.subject, data), body: renderTemplate(t.body, data) };
    },
    [templates, merge],
  );
  const first = existing ? { subject: existing.subject, body: existing.body } : renderWith(templateId, initialRecipient);
  const [subject, setSubject] = React.useState(first.subject);
  const [body, setBody] = React.useState(first.body);
  const [touched, setTouched] = React.useState(!!existing);
  const [emailId, setEmailId] = React.useState(existing?.id ?? null);

  // Re-render the template when the recipient or template changes, unless the text was edited by hand.
  const applyTemplate = (tplId: string, r: Recipient | null, force = false) => {
    if (touched && !force) return;
    const out = renderWith(tplId, r);
    setSubject(out.subject);
    setBody(out.body);
  };

  const save = useServerAction(saveEmailAction);
  const send = useServerAction(sendEmailAction);
  const enroll = useServerAction(enrollAction);
  const [sequenceId, setSequenceId] = React.useState(props.sequences[0]?.id ?? "");
  const placeholders = unresolvedPlaceholders(`${subject}\n${body}`);
  const busy = save.pending || send.pending;
  const realTemplateId = templateId.startsWith("builtin:") ? null : templateId || null;

  const persist = async (status: "DRAFT" | "PENDING_APPROVAL") => {
    const r = await save.run({ id: emailId, companyId: company.id, contactId, toEmail, subject, body, templateId: realTemplateId, status });
    const id = (r?.data as { id?: string } | undefined)?.id ?? null;
    if (r?.ok && id) setEmailId(id);
    return r?.ok ? id : null;
  };

  const mailto = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${body}\n${props.footer}`)}`;

  if (company.doNotContact) {
    return <Alert tone="danger" title="This prospect is marked Do not contact">Remove that flag on the profile first if they've asked to hear from you.</Alert>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="To">
              <Select
                value={recipientKey}
                onChange={(e) => {
                  setRecipientKey(e.target.value);
                  applyTemplate(templateId, recipients.find((r) => r.email === e.target.value) ?? null);
                }}
              >
                {!recipients.length ? <option value="">No email on file</option> : null}
                {recipients.map((r) => (
                  <option key={r.email} value={r.email}>
                    {r.name}{r.title ? `, ${r.title}` : ""} · {r.email}{r.status === "VERIFIED" ? "" : " (unverified)"}
                  </option>
                ))}
                <option value="custom">Another address…</option>
              </Select>
            </Field>
            <Field label="Template">
              <Select
                value={templateId}
                onChange={(e) => {
                  if (touched && !window.confirm("Replace your edits with this template?")) return;
                  setTemplateId(e.target.value);
                  setTouched(false);
                  applyTemplate(e.target.value, recipient, true);
                }}
              >
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.industries.includes(company.industry) ? " (this industry)" : ""}</option>)}
              </Select>
            </Field>
          </div>
          {recipientKey === "custom" || !recipients.length ? (
            <Field label="Recipient email" hint="Only use an address the business published or gave you.">
              <Input type="email" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setRecipientKey("custom"); }} placeholder="name@company.com" />
            </Field>
          ) : null}
          {!recipients.length ? (
            <Alert tone="neutral">
              No email on file{props.contactsWithoutEmail.length ? ` for ${props.contactsWithoutEmail.join(", ")}` : ""}.
              {company.contactFormUrl ? <> They have a <a className="underline" href={company.contactFormUrl} target="_blank" rel="noreferrer noopener">contact form</a>; you can paste this message there instead.</> : null}
            </Alert>
          ) : null}
          <Field label="Subject">
            <Input value={subject} onChange={(e) => { setSubject(e.target.value); setTouched(true); }} />
          </Field>
          <Field label="Message">
            <Textarea rows={16} value={body} onChange={(e) => { setBody(e.target.value); setTouched(true); }} className="font-sans leading-6" />
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Added automatically when sent</p>
            <pre className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-sans text-xs leading-5 text-muted">{props.footer || "Set your signature and mailing address in Settings → Outreach."}</pre>
          </div>
          {placeholders.length ? <Alert tone="warning">Fill in or remove before sending: {placeholders.join(", ")}</Alert> : null}
          {props.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {props.provider !== "manual" ? (
                <Button
                  variant="primary"
                  disabled={busy || !toEmail || !!placeholders.length}
                  onClick={async () => {
                    if (!window.confirm(`Send this email to ${toEmail} now?`)) return;
                    const id = await persist("PENDING_APPROVAL");
                    if (!id) return;
                    const r = await send.run(id);
                    if (r?.ok) router.push(`/leads/${company.id}`);
                  }}
                >
                  <Send /> {send.pending ? "Sending…" : "Approve & send now"}
                </Button>
              ) : null}
              <Button variant={props.provider === "manual" ? "primary" : "secondary"} disabled={busy || !toEmail} onClick={async () => { if (await persist("PENDING_APPROVAL")) router.push("/outreach"); }}>
                <Inbox /> Add to approval queue
              </Button>
              <Button variant="ghost" disabled={busy || !toEmail} onClick={() => persist("DRAFT")}><Save /> Save draft</Button>
              <Button asChild variant="ghost"><a href={mailto}><ExternalLink /> Open in my mail app</a></Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Add to a sequence instead" description="Drafts this email and the follow-ups on a schedule. Each one waits for your approval." />
          <CardBody className="flex flex-col gap-3">
            {props.activeSequence ? (
              <p className="text-sm text-muted">Already in &ldquo;{props.activeSequence}&rdquo;.</p>
            ) : props.sequences.length ? (
              <>
                <Select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label="Sequence">
                  {props.sequences.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.steps} emails)</option>)}
                </Select>
                <Button
                  disabled={enroll.pending || !recipients.length || !props.canEdit}
                  onClick={async () => {
                    const r = await enroll.run({ companyIds: [company.id], sequenceId, contactId: recipient?.contactId ?? null });
                    if (r?.ok) router.push("/outreach");
                  }}
                >
                  <ListPlus /> Start sequence
                </Button>
                <p className="text-xs text-muted">Sequences use the saved templates, not the text on the left.</p>
              </>
            ) : (
              <p className="text-sm text-muted">No sequences yet. <Link href="/outreach/sequences" className="text-accent hover:underline">Create one</Link>.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Merge fields" description="Use these in templates. Blank optional fields drop their line." />
          <CardBody>
            <ul className="space-y-1 text-xs">
              {MERGE_FIELDS.map((f) => <li key={f.key}><code className="rounded bg-surface-2 px-1">{`{{${f.key}}}`}</code> <span className="text-muted">{f.label}</span></li>)}
              <li><code className="rounded bg-surface-2 px-1">[[note]]</code> <span className="text-muted">A reminder to yourself; blocks sending until removed</span></li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
