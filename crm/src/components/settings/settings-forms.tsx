"use client";

import { Upload, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  createUserAction, restoreBackupAction, saveOutreachSettingsAction, saveSalesSettingsAction, saveScoringAction, saveSecuritySettingsAction, updateUserAction,
} from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { ActionForm, SubmitButton, useServerAction } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { MultiSelect } from "@/components/ui/multi-select";
import { ROLES, ROLE_LABEL } from "@/lib/constants";
import type { OutreachSettings, SalesSettings, SecuritySettings } from "@/lib/settings";
import type { RoleKey } from "@/lib/auth/roles";

export function SalesSettingsForm({ values, disabled }: { values: SalesSettings; disabled: boolean }) {
  return (
    <ActionForm action={saveSalesSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={disabled} className="contents">
        <Field label="Default price per user per month ($)"><Input name="pricePerUser" type="number" min={0} step="0.01" defaultValue={values.pricePerUser} /></Field>
        <Field label="Default daily call goal" hint="For new users; each person can change their own on the Call Center page."><Input name="dailyCallGoal" type="number" min={1} max={200} defaultValue={values.dailyCallGoal} /></Field>
        <Field label="Wait before calling again after no answer (days)"><Input name="retryAfterNoAnswerDays" type="number" min={1} max={30} defaultValue={values.retryAfterNoAnswerDays} /></Field>
        <Field label="Stop queueing after this many attempts"><Input name="maxCallAttempts" type="number" min={1} max={20} defaultValue={values.maxCallAttempts} /></Field>
        {!disabled ? <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div> : null}
      </fieldset>
    </ActionForm>
  );
}

export function OutreachSettingsForm({ values, disabled }: { values: OutreachSettings; disabled: boolean }) {
  return (
    <ActionForm action={saveOutreachSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={disabled} className="contents">
        <Field label="Your name (signs emails)"><Input name="senderName" defaultValue={values.senderName} required /></Field>
        <Field label="Company name"><Input name="companyName" defaultValue={values.companyName} required /></Field>
        <Field label="Website"><Input name="website" defaultValue={values.website} /></Field>
        <Field label="Your phone number" hint="Read out in call-script voicemails."><Input name="senderPhone" type="tel" defaultValue={values.senderPhone} placeholder="(555) 555-0100" /></Field>
        <Field label="Daily sending limit" hint="New sending accounts should stay low (20–40 a day)."><Input name="dailySendCap" type="number" min={1} max={500} defaultValue={values.dailySendCap} /></Field>
        <Field label="Signature (under your name)" className="sm:col-span-2"><Textarea name="signature" rows={3} defaultValue={values.signature} /></Field>
        <Field label="Business mailing address" hint="Street or PO box, city, state, ZIP. Required in every sales email." className="sm:col-span-2">
          <Input name="mailingAddress" defaultValue={values.mailingAddress} placeholder="123 Main St, Suite 100, Irvine, CA 92618" />
        </Field>
        <Field label="Opt-out line" className="sm:col-span-2"><Input name="optOutLine" defaultValue={values.optOutLine} /></Field>
        <Field label="Default follow-up after an email (days)"><Input name="defaultFollowUpDays" type="number" min={1} max={60} defaultValue={values.defaultFollowUpDays} /></Field>
        {!disabled ? <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div> : null}
      </fieldset>
    </ActionForm>
  );
}

export function ScoringForm({
  factors, weights: initial, coreRegions: cr, regulatedIndustries: ri, regions, industries,
}: {
  factors: { key: string; label: string }[];
  weights: Record<string, number>;
  coreRegions: string[];
  regulatedIndustries: string[];
  regions: readonly { key: string; label: string }[];
  industries: readonly { key: string; label: string }[];
}) {
  const [weights, setWeights] = React.useState(initial);
  const [coreRegions, setCoreRegions] = React.useState(cr);
  const [regulated, setRegulated] = React.useState(ri);
  const { run, pending } = useServerAction(saveScoringAction);
  const total = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {factors.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input type="number" min={0} max={100} value={weights[f.key]} onChange={(e) => setWeights((w) => ({ ...w, [f.key]: Number(e.target.value) }))} />
          </Field>
        ))}
      </div>
      <p className={total === 100 ? "text-sm text-muted" : "text-sm font-medium text-danger"}>Total: {total} / 100</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Core service regions" hint="Full geography points."><MultiSelect label="Regions" options={regions} value={coreRegions} onChange={setCoreRegions} /></Field>
        <Field label="Regulated industries" hint="Earn security-requirement points."><MultiSelect label="Industries" options={industries} value={regulated} onChange={setRegulated} searchable /></Field>
      </div>
      <Button variant="primary" className="self-start" disabled={pending || total !== 100} onClick={() => run({ weights, coreRegions, regulatedIndustries: regulated })}>
        {pending ? "Re-scoring…" : "Save and re-score"}
      </Button>
    </div>
  );
}

export function SecurityForm({ values, disabled }: { values: SecuritySettings; disabled: boolean }) {
  const [requireMfa, setRequireMfa] = React.useState(values.requireMfa);
  const [hours, setHours] = React.useState(values.sessionHours);
  const { run, pending } = useServerAction(saveSecuritySettingsAction);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={requireMfa} disabled={disabled} onChange={(e) => setRequireMfa(e.target.checked)} /> Require two-step sign-in for everyone</label>
      {!requireMfa ? <Alert tone="warning">Turning this off is not recommended; the CRM holds client contact data.</Alert> : null}
      <Field label="Sign people out after (hours)" className="max-w-xs"><Input type="number" min={1} max={720} value={hours} disabled={disabled} onChange={(e) => setHours(Number(e.target.value))} /></Field>
      {!disabled ? <Button variant="primary" className="self-start" disabled={pending} onClick={() => run({ requireMfa, sessionHours: hours })}>Save</Button> : <p className="text-xs text-muted">Only an owner can change security settings.</p>}
    </div>
  );
}

interface U { id: string; name: string; email: string; role: string; active: boolean; mfaEnabled: boolean; lastLoginAt: string | null }

export function UserAdmin({ users, currentUserId, isOwner }: { users: U[]; currentUserId: string; isOwner: boolean }) {
  const router = useRouter();
  const update = useServerAction(updateUserAction);
  const [adding, setAdding] = React.useState(false);
  const act = async (id: string, patch: Parameters<typeof updateUserAction>[1], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const r = await update.run(id, patch);
    if (r?.ok) router.refresh();
  };
  const roles = ROLES.filter((r) => isOwner || r.key !== "OWNER");
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{u.name}</span> {u.id === currentUserId ? <Badge tone="accent">You</Badge> : null} {!u.active ? <Badge tone="neutral">Deactivated</Badge> : null}
              <span className="block text-xs text-muted">{u.email} · {u.mfaEnabled ? "two-step on" : "two-step not set up"} · {u.lastLoginAt ? `last sign-in ${u.lastLoginAt}` : "never signed in"}</span>
            </span>
            <Select
              className="h-8 w-32"
              value={u.role}
              disabled={update.pending || (u.role === "OWNER" && !isOwner) || u.id === currentUserId}
              onChange={(e) => act(u.id, { role: e.target.value as RoleKey })}
              aria-label={`Role for ${u.name}`}
            >
              {(u.role === "OWNER" && !isOwner ? ROLES : roles).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
            {u.id !== currentUserId && (u.role !== "OWNER" || isOwner) ? (
              <Dropdown>
                <DropdownTrigger asChild><Button size="sm" variant="ghost">Manage</Button></DropdownTrigger>
                <DropdownContent>
                  <DropdownItem
                    onSelect={() => {
                      const pw = window.prompt(`New temporary password for ${u.name} (at least 12 characters). Share it privately.`);
                      if (pw) void act(u.id, { password: pw });
                    }}
                  >
                    Reset password
                  </DropdownItem>
                  {u.mfaEnabled ? <DropdownItem onSelect={() => act(u.id, { resetMfa: true }, `Reset two-step sign-in for ${u.name}? They'll set it up again at next sign-in.`)}>Reset two-step sign-in</DropdownItem> : null}
                  <DropdownSeparator />
                  {u.active ? (
                    <DropdownItem className="text-danger" onSelect={() => act(u.id, { active: false }, `Deactivate ${u.name}? They're signed out immediately.`)}>Deactivate</DropdownItem>
                  ) : (
                    <DropdownItem onSelect={() => act(u.id, { active: true })}>Reactivate</DropdownItem>
                  )}
                </DropdownContent>
              </Dropdown>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <ActionForm action={createUserAction} resetOnSuccess onSuccess={() => { setAdding(false); router.refresh(); }} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
          <Field label="Name"><Input name="name" required /></Field>
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Field label="Role">
            <Select name="role" defaultValue="SALES">{roles.map((r) => <option key={r.key} value={r.key}>{ROLE_LABEL[r.key]}</option>)}</Select>
          </Field>
          <Field label="Temporary password" hint="12+ characters. Share it privately, not by email."><Input name="password" type="text" autoComplete="off" required minLength={12} /></Field>
          <div className="flex gap-2 sm:col-span-2"><SubmitButton>Add user</SubmitButton><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button></div>
        </ActionForm>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setAdding(true)}><UserPlus /> Add user</Button>
      )}
    </div>
  );
}

export function RestoreForm() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await restoreBackupAction(fd);
          setResult(r);
          if (r?.ok) router.refresh();
        });
      }}
    >
      <p className="text-sm font-medium">Restore from a backup</p>
      <p className="text-xs text-muted">Adds records from the backup that aren&apos;t here. It never deletes or overwrites anything, and user accounts aren&apos;t restored.</p>
      <Input type="file" name="file" accept="application/json,.json" required />
      <Field label='Type "RESTORE" to confirm'><Input name="confirm" autoComplete="off" className="max-w-40" required /></Field>
      <Button type="submit" variant="secondary" className="self-start" disabled={pending}><Upload /> {pending ? "Restoring…" : "Restore"}</Button>
      {result?.error ? <Alert tone="danger">{result.error}</Alert> : result?.message ? <Alert tone="success">{result.message}</Alert> : null}
    </form>
  );
}
