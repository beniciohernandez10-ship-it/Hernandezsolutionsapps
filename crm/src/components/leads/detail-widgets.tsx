"use client";

import { AlarmClockPlus, Check, MessageSquareReply, PencilLine, PhoneCall, Plus, Trash2, Upload, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  addNoteAction, changeStageAction, completeTaskAction, createTaskAction, deleteAttachmentAction, deleteContactAction, deleteLeadAction, deleteTaskAction,
  markReplyAction, saveContactAction, setManualScoreAction, setVerificationAction, snoozeTaskAction, uploadAttachmentAction,
} from "@/app/(app)/leads/actions";
import { addToQueueAction } from "@/app/(app)/calls/actions";
import { CallLogger } from "@/components/calls/call-logger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { ActionForm, SubmitButton, useServerAction } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { CONTACT_METHODS, PIPELINE_STAGES, TASK_TYPES, VERIFICATION } from "@/lib/constants";

function useRefresh() {
  const router = useRouter();
  return React.useCallback(() => router.refresh(), [router]);
}

export function StageSelect({ companyId, stage, disabled }: { companyId: string; stage: string; disabled?: boolean }) {
  const { run, pending } = useServerAction(changeStageAction);
  const refresh = useRefresh();
  return (
    <Select
      aria-label="Pipeline stage"
      className="h-8 w-auto min-w-44 text-sm font-medium"
      value={stage}
      disabled={disabled || pending}
      onChange={async (e) => {
        const r = await run(companyId, e.target.value);
        if (r?.ok) refresh();
      }}
    >
      {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </Select>
  );
}

export function LogCallButton(props: { companyId: string; contacts: { id: string; name: string }[]; defaultContactId?: string | null; phone?: string | null; retryDays?: number; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = React.useState(false);
  const refresh = useRefresh();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={props.variant ?? "secondary"}><PhoneCall /> Log call</Button>
      </DialogTrigger>
      <DialogContent title="Log a call" description="Logging a call keeps the prospect in your list and updates its timeline.">
        <CallLogger
          companyId={props.companyId}
          contacts={props.contacts}
          defaultContactId={props.defaultContactId}
          phoneDialed={props.phone}
          retryDays={props.retryDays}
          onLogged={() => {
            setOpen(false);
            refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function QueueButton({ companyId }: { companyId: string }) {
  const { run, pending } = useServerAction(addToQueueAction);
  return (
    <Button variant="secondary" disabled={pending} onClick={() => run(companyId)}>
      <Plus /> Add to today&apos;s calls
    </Button>
  );
}

export function NoteForm({ companyId }: { companyId: string }) {
  const refresh = useRefresh();
  return (
    <ActionForm action={addNoteAction.bind(null, companyId)} resetOnSuccess onSuccess={refresh} className="flex flex-col gap-2">
      <Textarea name="body" rows={3} placeholder="Add a note: what you learned, who to ask for, what they use today…" required />
      <div className="flex items-center justify-between gap-2">
        <Select name="type" className="h-8 w-40" aria-label="Note type">
          <option value="NOTE">Note</option>
          <option value="MEETING">Meeting notes</option>
        </Select>
        <SubmitButton size="sm" pendingText="Saving…">Add to timeline</SubmitButton>
      </div>
    </ActionForm>
  );
}

function defaultDue(days = 1) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function TaskDialog({ companyId, contacts, users, trigger }: { companyId: string; contacts: { id: string; name: string }[]; users: { id: string; name: string }[]; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const refresh = useRefresh();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="secondary"><AlarmClockPlus /> Schedule follow-up</Button>}</DialogTrigger>
      <DialogContent title="Schedule a follow-up" description="Callbacks, follow-up emails, meetings, proposals and contract reminders.">
        <ActionForm
          action={createTaskAction.bind(null, companyId)}
          onSuccess={() => {
            setOpen(false);
            refresh();
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Type">
            <Select name="type" defaultValue="CALLBACK">
              {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Due">
            <Input name="dueAt" type="datetime-local" defaultValue={defaultDue()} required />
          </Field>
          <Field label="Title" hint="Optional" className="sm:col-span-2"><Input name="title" placeholder="Send the security check summary" /></Field>
          <Field label="Length (minutes)" hint="Meetings only"><Input name="durationMin" type="number" min={5} max={480} placeholder="30" /></Field>
          {contacts.length ? (
            <Field label="Contact">
              <Select name="contactId" defaultValue="">
                <option value="">—</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          ) : null}
          {users.length > 1 ? (
            <Field label="Assigned to">
              <Select name="assigneeId" defaultValue="">
                <option value="">Me</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} /></Field>
          <div className="flex justify-end sm:col-span-2"><SubmitButton pendingText="Saving…">Schedule</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function TaskActions({ taskId }: { taskId: string }) {
  const done = useServerAction(completeTaskAction);
  const snooze = useServerAction(snoozeTaskAction);
  const del = useServerAction(deleteTaskAction);
  const refresh = useRefresh();
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="subtle" disabled={done.pending} onClick={async () => { await done.run(taskId); refresh(); }}>
        <Check /> Done
      </Button>
      <Dropdown>
        <DropdownTrigger asChild><Button size="sm" variant="ghost">Snooze</Button></DropdownTrigger>
        <DropdownContent>
          {[1, 2, 7, 14, 30].map((d) => (
            <DropdownItem key={d} disabled={snooze.pending} onSelect={async () => { await snooze.run(taskId, d); refresh(); }}>
              {d === 1 ? "1 day" : d === 7 ? "1 week" : d === 14 ? "2 weeks" : d === 30 ? "1 month" : `${d} days`}
            </DropdownItem>
          ))}
          <DropdownItem
            onSelect={async () => {
              const v = window.prompt("Snooze for how many days?", "3");
              const n = Number(v);
              if (Number.isInteger(n) && n > 0) {
                await snooze.run(taskId, n);
                refresh();
              }
            }}
          >
            Custom…
          </DropdownItem>
          <DropdownItem className="text-danger" onSelect={async () => { if (window.confirm("Delete this follow-up?")) { await del.run(taskId); refresh(); } }}>
            <Trash2 /> Delete
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
  );
}

export interface ContactValues {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  emailStatus: string;
  phone: string | null;
  phoneStatus: string;
  linkedinUrl: string | null;
  preferredContactMethod: string;
  source: string | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
  doNotContact: boolean;
  notes: string | null;
}

export function ContactDialog({ companyId, contact, trigger }: { companyId: string; contact?: ContactValues; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const refresh = useRefresh();
  const c = contact;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" variant="ghost"><UserPlus /> Add contact</Button>}
      </DialogTrigger>
      <DialogContent title={c ? `Edit ${c.name}` : "Add a contact"} description="Only record details you've confirmed or that came from a source. Mark anything unconfirmed as Unverified.">
        <ActionForm
          action={saveContactAction.bind(null, companyId, c?.id ?? null)}
          onSuccess={() => {
            setOpen(false);
            refresh();
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Name"><Input name="name" required defaultValue={c?.name} /></Field>
          <Field label="Title"><Input name="title" defaultValue={c?.title ?? ""} placeholder="Office manager" /></Field>
          <Field label="Direct email"><Input name="email" type="email" defaultValue={c?.email ?? ""} /></Field>
          <Field label="Email status">
            <Select name="emailStatus" defaultValue={c?.emailStatus ?? "UNVERIFIED"}>
              {VERIFICATION.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Direct phone"><Input name="phone" type="tel" defaultValue={c?.phone ?? ""} /></Field>
          <Field label="Phone status">
            <Select name="phoneStatus" defaultValue={c?.phoneStatus ?? "UNVERIFIED"}>
              {VERIFICATION.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="LinkedIn profile"><Input name="linkedinUrl" defaultValue={c?.linkedinUrl ?? ""} /></Field>
          <Field label="Preferred contact method">
            <Select name="preferredContactMethod" defaultValue={c?.preferredContactMethod ?? "UNKNOWN"}>
              {CONTACT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Where you found this contact" className="sm:col-span-2"><Input name="source" defaultValue={c?.source ?? ""} placeholder="Company website team page, Oct 2026" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} /></Field>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2"><Checkbox name="isPrimary" defaultChecked={c?.isPrimary} /> Primary contact</label>
            <label className="flex items-center gap-2"><Checkbox name="isDecisionMaker" defaultChecked={c?.isDecisionMaker} /> Confirmed decision-maker</label>
            <label className="flex items-center gap-2"><Checkbox name="doNotContact" defaultChecked={c?.doNotContact} /> Do not contact</label>
          </div>
          <div className="flex justify-end sm:col-span-2"><SubmitButton pendingText="Saving…">Save contact</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function ContactMenu({ companyId, contact }: { companyId: string; contact: ContactValues }) {
  const del = useServerAction(deleteContactAction);
  const refresh = useRefresh();
  return (
    <div className="flex items-center">
      <ContactDialog companyId={companyId} contact={contact} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Edit ${contact.name}`}><PencilLine /></Button>} />
      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${contact.name}`} disabled={del.pending} onClick={async () => { if (window.confirm(`Remove ${contact.name}?`)) { await del.run(contact.id); refresh(); } }}>
        <Trash2 />
      </Button>
    </div>
  );
}

export function VerifySelect({ target, field, status }: { target: { kind: "company" | "contact"; id: string }; field: "email" | "phone"; status: string }) {
  const { run, pending } = useServerAction(setVerificationAction);
  const refresh = useRefresh();
  return (
    <Select
      aria-label={`${field} verification`}
      className="h-7 w-28 text-xs"
      value={status}
      disabled={pending}
      onChange={async (e) => {
        await run(target, field, e.target.value as never);
        refresh();
      }}
    >
      {VERIFICATION.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
    </Select>
  );
}

export function AttachmentUpload({ companyId }: { companyId: string }) {
  const refresh = useRefresh();
  return (
    <ActionForm action={uploadAttachmentAction.bind(null, companyId)} resetOnSuccess onSuccess={refresh} className="flex flex-wrap items-center gap-2">
      <Input type="file" name="file" required className="h-auto max-w-xs py-1.5 text-xs" aria-label="Choose file" />
      <SubmitButton size="sm" pendingText="Uploading…"><Upload /> Upload</SubmitButton>
      <span className="text-xs text-subtle">Up to 4 MB. Don&apos;t upload passwords or credentials.</span>
    </ActionForm>
  );
}

export function DeleteAttachment({ id, name }: { id: string; name: string }) {
  const { run, pending } = useServerAction(deleteAttachmentAction);
  const refresh = useRefresh();
  return (
    <Button size="icon-sm" variant="danger-ghost" aria-label={`Delete ${name}`} disabled={pending} onClick={async () => { if (window.confirm(`Delete ${name}?`)) { await run(id); refresh(); } }}>
      <Trash2 />
    </Button>
  );
}

export function ScoreAdjust({ companyId, factor, label, max, current }: { companyId: string; factor: string; label: string; max: number; current?: { share: number; evidence: string } }) {
  const [open, setOpen] = React.useState(false);
  const { run, pending } = useServerAction(setManualScoreAction);
  const refresh = useRefresh();
  const [points, setPoints] = React.useState(current ? Math.round(current.share * max) : 0);
  const [evidence, setEvidence] = React.useState(current?.evidence ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs text-accent hover:underline">{current ? "Edit" : "Set"}</button>
      </DialogTrigger>
      <DialogContent title={label} description="Set this factor from evidence you've checked. Record what you saw so the score stays honest.">
        <div className="flex flex-col gap-4">
          <Field label={`Points (0–${max})`}>
            <Input type="number" min={0} max={max} value={points} onChange={(e) => setPoints(Math.max(0, Math.min(max, Number(e.target.value))))} />
          </Field>
          <Field label="Evidence" hint="For example: MX records point to Microsoft 365 (checked Oct 15).">
            <Textarea rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <div className="flex justify-between gap-2">
            {current ? (
              <Button variant="ghost" disabled={pending} onClick={async () => { const r = await run(companyId, factor, null, ""); if (r?.ok) { setOpen(false); refresh(); } }}>
                Use automatic value
              </Button>
            ) : <span />}
            <Button variant="primary" disabled={pending} onClick={async () => { const r = await run(companyId, factor, max ? points / max : 0, evidence); if (r?.ok) { setOpen(false); refresh(); } }}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarkReplyButton({ companyId }: { companyId: string }) {
  const { run, pending } = useServerAction(markReplyAction);
  const refresh = useRefresh();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        const note = window.prompt("They replied. Add a short note about the reply (optional):", "");
        if (note === null) return;
        await run(companyId, note);
        refresh();
      }}
    >
      <MessageSquareReply /> They replied
    </Button>
  );
}

export function DeleteLeadButton({ companyId, name }: { companyId: string; name: string }) {
  const [pending, start] = React.useTransition();
  return (
    <button
      className="text-xs text-danger hover:underline disabled:opacity-50"
      disabled={pending}
      onClick={() => {
        if (window.prompt(`This permanently deletes ${name} and its whole history. Type DELETE to confirm.`) === "DELETE") start(() => deleteLeadAction(companyId));
      }}
    >
      Delete this prospect permanently
    </button>
  );
}
