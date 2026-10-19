"use client";

import { Pause, Play, Timer } from "lucide-react";
import * as React from "react";
import { logCallAction } from "@/app/(app)/calls/actions";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { suggestedFollowUp } from "@/lib/calls";
import { CALL_OUTCOMES, TASK_TYPES, type CallOutcomeKey } from "@/lib/constants";
import { cn } from "@/lib/utils";

function localInput(daysAhead: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  // Skip weekends for suggested follow-ups.
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useCallTimer() {
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [base, setBase] = React.useState(0);
  React.useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setElapsed(base + Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt, base]);
  return {
    running: startedAt !== null,
    seconds: elapsed,
    start: () => setStartedAt(Date.now()),
    pause: () => {
      setBase(elapsed);
      setStartedAt(null);
    },
    reset: () => {
      setStartedAt(null);
      setBase(0);
      setElapsed(0);
    },
  };
}

export function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Outcome buttons, notes, timer and follow-up scheduling for one call.
 * Logging a call never removes the prospect; it only records what happened.
 */
export function CallLogger({
  companyId,
  contacts,
  defaultContactId,
  phoneDialed,
  queueItemId,
  retryDays = 2,
  timer: externalTimer,
  onLogged,
  compact,
}: {
  companyId: string;
  contacts: { id: string; name: string }[];
  defaultContactId?: string | null;
  phoneDialed?: string | null;
  queueItemId?: string | null;
  retryDays?: number;
  timer?: ReturnType<typeof useCallTimer>;
  onLogged?: () => void;
  compact?: boolean;
}) {
  const ownTimer = useCallTimer();
  const timer = externalTimer ?? ownTimer;
  const [outcome, setOutcome] = React.useState<CallOutcomeKey | null>(null);
  const [contactId, setContactId] = React.useState(defaultContactId ?? "");
  const [notes, setNotes] = React.useState("");
  const [follow, setFollow] = React.useState(false);
  const [followType, setFollowType] = React.useState("CALLBACK");
  const [followAt, setFollowAt] = React.useState(localInput(1));
  const [followNotes, setFollowNotes] = React.useState("");
  const [manualMinutes, setManualMinutes] = React.useState("");
  const { run, pending } = useServerAction(logCallAction);

  React.useEffect(() => setContactId(defaultContactId ?? ""), [defaultContactId, companyId]);

  const choose = (o: CallOutcomeKey) => {
    setOutcome(o);
    const s = suggestedFollowUp(o, retryDays);
    if (s) {
      setFollow(true);
      setFollowType(s.type);
      setFollowAt(localInput(s.days, s.type === "EMAIL" ? 16 : 12));
    } else setFollow(false);
  };

  const submit = async () => {
    if (!outcome) return;
    const durationSec = timer.seconds > 0 ? timer.seconds : manualMinutes ? Math.round(Number(manualMinutes) * 60) : null;
    const r = await run({
      companyId,
      contactId: contactId || null,
      queueItemId: queueItemId ?? null,
      outcome,
      durationSec,
      notes: notes || null,
      phoneDialed: phoneDialed ?? null,
      followUp: follow ? { type: followType as never, dueLocal: followAt, notes: followNotes || undefined } : null,
    });
    if (r?.ok) {
      setOutcome(null);
      setNotes("");
      setFollowNotes("");
      setManualMinutes("");
      setFollow(false);
      timer.reset();
      onLogged?.();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!externalTimer ? (
        <div className="flex items-center gap-2 text-sm">
          <Timer className="size-4 text-muted" />
          <span className="font-mono tabular-nums">{formatDuration(timer.seconds)}</span>
          {timer.running ? (
            <Button size="sm" variant="ghost" onClick={timer.pause}><Pause /> Stop timer</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={timer.start}><Play /> Start timer</Button>
          )}
          {!timer.seconds ? (
            <Input className="ml-auto h-8 w-28" type="number" min={0} step="0.5" placeholder="or minutes" value={manualMinutes} onChange={(e) => setManualMinutes(e.target.value)} aria-label="Call length in minutes" />
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium text-muted">What happened?</p>
        <div className={cn("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
          {CALL_OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => choose(o.key)}
              aria-pressed={outcome === o.key}
              className={cn(
                "rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                outcome === o.key ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent/50 hover:bg-accent-soft",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {contacts.length ? (
        <Field label="Who you spoke with or asked for">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Main line / no specific person</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      ) : null}

      <Field label="Quick notes">
        <Textarea rows={compact ? 2 : 3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gatekeeper's name, best time to call, what they use today…" />
      </Field>

      <div className="rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Schedule a follow-up
        </label>
        {follow ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={followType} onChange={(e) => setFollowType(e.target.value)}>
                {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="When">
              <Input type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-1.5 sm:col-span-2">
              {[["Tomorrow", 1], ["In 2 days", 2], ["Next week", 7], ["In 2 weeks", 14], ["In a month", 30]].map(([label, d]) => (
                <button key={label} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-2" onClick={() => setFollowAt(localInput(Number(d)))}>
                  {label}
                </button>
              ))}
            </div>
            <Field label="Follow-up note" className="sm:col-span-2">
              <Input value={followNotes} onChange={(e) => setFollowNotes(e.target.value)} placeholder="Ask for the office manager" />
            </Field>
          </div>
        ) : null}
      </div>

      <Button variant="primary" size="lg" disabled={!outcome || pending} onClick={submit}>
        {pending ? "Saving…" : outcome ? "Log call" : "Pick an outcome to log the call"}
      </Button>
    </div>
  );
}
