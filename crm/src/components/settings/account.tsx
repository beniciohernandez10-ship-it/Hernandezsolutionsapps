"use client";

import { Copy, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  changePasswordAction, confirmMfaAction, disableMfaAction, revokeCalendarTokenAction, rotateCalendarTokenAction, setDailyDigestAction, signOutOtherSessionsAction, startMfaSetupAction, updateProfileAction,
} from "@/app/(app)/account/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton, toast, useServerAction } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/input";

export function MfaSection({ enabled, required }: { enabled: boolean; required: boolean }) {
  const router = useRouter();
  const start = useServerAction(startMfaSetupAction);
  const confirm = useServerAction(confirmMfaAction);
  const [setup, setSetup] = React.useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = React.useState("");
  if (enabled) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-success" /> On for your account.</p>
        {!required ? (
          <details>
            <summary className="cursor-pointer text-sm text-muted">Turn it off</summary>
            <ActionForm action={disableMfaAction} onSuccess={() => router.refresh()} className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
              <Field label="Current code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required /></Field>
              <div className="flex items-end"><SubmitButton variant="danger">Turn off</SubmitButton></div>
            </ActionForm>
          </details>
        ) : null}
      </div>
    );
  }
  if (!setup) {
    return (
      <Button variant="primary" disabled={start.pending} onClick={async () => { const r = await start.run(); if (r?.ok) setSetup(r.data as { qr: string; secret: string }); }}>
        <KeyRound /> Set up two-step sign-in
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md border border-border bg-white p-1" />
      <div className="flex flex-1 flex-col gap-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open Microsoft Authenticator, Google Authenticator or 1Password.</li>
          <li>Add an account and scan this code.</li>
          <li>Enter the 6-digit code it shows.</li>
        </ol>
        <p className="text-xs text-muted">Can&apos;t scan? Enter this key: <code className="break-all rounded bg-surface-2 px-1">{setup.secret}</code></p>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await confirm.run(code);
            if (r?.ok) {
              setSetup(null);
              router.push("/");
            }
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="w-32" aria-label="Code" />
          <Button type="submit" variant="primary" disabled={confirm.pending || code.replace(/\s/g, "").length !== 6}>Turn on</Button>
        </form>
      </div>
    </div>
  );
}

export function DigestToggle({ on }: { on: boolean }) {
  const { run, pending } = useServerAction(setDailyDigestAction);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" defaultChecked={on} disabled={pending} onChange={(e) => run(e.target.checked)} />
      Send me the weekday morning email
    </label>
  );
}

export function ProfileForm({ name }: { name: string }) {
  return (
    <ActionForm action={updateProfileAction} className="flex items-end gap-2">
      <Field label="Your name" className="flex-1"><Input name="name" defaultValue={name} required /></Field>
      <SubmitButton>Save</SubmitButton>
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
      <Field label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
      <Field label="New password"><Input name="next" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Field label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <div className="sm:col-span-3"><SubmitButton>Change password</SubmitButton></div>
    </ActionForm>
  );
}

export function CalendarSection({ active, origin }: { active: boolean; origin: string }) {
  const router = useRouter();
  const rotate = useServerAction(rotateCalendarTokenAction);
  const revoke = useServerAction(revokeCalendarTokenAction);
  const [url, setUrl] = React.useState<string | null>(null);
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return (
    <div className="flex flex-col gap-3 text-sm">
      {url ? (
        <>
          <p>Copy this link now; it won&apos;t be shown again. In Outlook: Add calendar → Subscribe from web. In Google Calendar: Other calendars → From URL.</p>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
            <Button onClick={() => { void navigator.clipboard.writeText(url); toast("Copied."); }}><Copy /> Copy</Button>
          </div>
        </>
      ) : (
        <p className="flex items-center gap-2">{active ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>} {active ? "A calendar link exists. Create a new one to see it again; the old link stops working." : "No calendar link yet."}</p>
      )}
      <div className="flex gap-2">
        <Button
          variant={active ? "secondary" : "primary"}
          disabled={rotate.pending}
          onClick={async () => {
            if (active && !window.confirm("Create a new link? Calendars subscribed with the old link stop updating.")) return;
            const r = await rotate.run();
            if (r?.ok) { setUrl(`${base}/api/calendar/${(r.data as { token: string }).token}.ics`); router.refresh(); }
          }}
        >
          <RefreshCw /> {active ? "Create a new link" : "Create calendar link"}
        </Button>
        {active ? <Button variant="danger-ghost" disabled={revoke.pending} onClick={async () => { const r = await revoke.run(); if (r?.ok) { setUrl(null); router.refresh(); } }}>Turn off</Button> : null}
      </div>
    </div>
  );
}

export function SessionsSection({ sessions }: { sessions: { id: string; current: boolean; ip: string | null; agent: string | null; lastSeen: string }[] }) {
  const router = useRouter();
  const { run, pending } = useServerAction(signOutOtherSessionsAction);
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border text-sm">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate">{describeAgent(s.agent)}{s.current ? <Badge tone="accent" className="ml-2">This device</Badge> : null}</span>
              <span className="text-xs text-muted">{s.ip ?? "Unknown IP"} · active {s.lastSeen}</span>
            </span>
          </li>
        ))}
      </ul>
      {sessions.length > 1 ? <Button variant="secondary" className="self-start" disabled={pending} onClick={async () => { const r = await run(); if (r?.ok) router.refresh(); }}><LogOut /> Sign out other devices</Button> : null}
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}
