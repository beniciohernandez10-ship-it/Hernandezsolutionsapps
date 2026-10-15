"use client";

import { CalendarPlus, Check, ChevronRight, ExternalLink, Pause, Phone, Play, RefreshCw, RotateCcw, SkipForward, Target, Timer, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { generateQueueAction, removeQueueItemAction, restoreQueueItemAction, setDailyGoalAction, skipQueueItemAction } from "@/app/(app)/calls/actions";
import { PriorityBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { CallLogger, formatDuration, useCallTimer } from "@/components/calls/call-logger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { useServerAction } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyState, Progress } from "@/components/ui/misc";
import { CALL_OUTCOME_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface QueueEntry {
  id: string;
  status: "PENDING" | "DONE" | "SKIPPED";
  outcome: string | null;
  reason: string | null;
  contactId: string | null;
  company: {
    id: string;
    name: string;
    industry: string;
    isTech: boolean;
    subindustry: string | null;
    location: string;
    stage: string;
    priority: string;
    score: number | null;
    scoreIsEstimate: boolean;
    personalNote: string | null;
    notes: string | null;
    callCount: number;
    lastContacted: string | null;
    website: string | null;
    employeeCount: number | null;
    contacts: { id: string; name: string; title: string | null; email: string | null; isDecisionMaker: boolean }[];
    recent: { id: string; summary: string; body: string | null; when: string }[];
    nextTask: { title: string; notes: string | null; due: string } | null;
  };
  phones: { label: string; contactId: string | null; raw: string; display: string; href: string | null }[];
}

export function CallWorkspace({
  entries,
  callsToday,
  goal,
  tomorrowCount,
  tomorrowLabel,
  retryDays,
  scripts,
  canEdit,
}: {
  entries: QueueEntry[];
  callsToday: number;
  goal: number;
  tomorrowCount: number;
  tomorrowLabel: string;
  retryDays: number;
  scripts: { id: string; name: string; startup: boolean; body: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const refresh = React.useCallback(() => router.refresh(), [router]);
  const pending = entries.filter((e) => e.status === "PENDING");
  const [selectedId, setSelectedId] = React.useState<string | null>(pending[0]?.id ?? entries[0]?.id ?? null);
  const selected = entries.find((e) => e.id === selectedId) ?? pending[0] ?? null;
  const timer = useCallTimer();
  const [dialed, setDialed] = React.useState<{ raw: string; contactId: string | null } | null>(null);
  const generate = useServerAction(generateQueueAction);
  const skip = useServerAction(skipQueueItemAction);
  const restore = useServerAction(restoreQueueItemAction);
  const remove = useServerAction(removeQueueItemAction);

  // Session clock for the lunch-hour block.
  const [sessionStart, setSessionStart] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!sessionStart) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sessionStart]);

  React.useEffect(() => {
    setDialed(null);
    timer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const goNext = React.useCallback(() => {
    const idx = pending.findIndex((p) => p.id === selected?.id);
    const next = pending[idx + 1] ?? pending.find((p) => p.id !== selected?.id) ?? null;
    setSelectedId(next?.id ?? null);
  }, [pending, selected?.id]);

  const done = entries.filter((e) => e.status === "DONE").length;
  const goalMet = callsToday >= goal;
  const scriptDefault = selected?.company.isTech ? scripts.find((s) => s.startup) ?? scripts[0] : scripts.find((s) => !s.startup) ?? scripts[0];
  const [scriptId, setScriptId] = React.useState<string | null>(null);
  const script = scripts.find((s) => s.id === scriptId) ?? scriptDefault;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Target className="size-4 text-accent" />
                {callsToday} of {goal} calls today
                {goalMet ? <Badge tone="success"><Check /> Goal met</Badge> : null}
              </span>
              <span className="text-muted">{pending.length} left in queue · {done} logged from queue</span>
            </div>
            <Progress value={callsToday} max={goal} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sessionStart ? (
              <Button variant="ghost" onClick={() => setSessionStart(null)} title="Stop the call-block clock">
                <Timer /> {formatDuration(Math.floor((now - sessionStart) / 1000))} <Pause />
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => { setSessionStart(Date.now()); setNow(Date.now()); }}>
                <Timer /> Start call block
              </Button>
            )}
            {canEdit ? (
              <>
                <GoalEditor goal={goal} onSaved={refresh} />
                <Dropdown>
                  <DropdownTrigger asChild>
                    <Button variant={entries.length ? "secondary" : "primary"} disabled={generate.pending}>
                      <RefreshCw className={cn(generate.pending && "animate-spin")} /> Build queue
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent>
                    <DropdownItem onSelect={async () => { const r = await generate.run("today", false); if (r?.ok) refresh(); }}>
                      Top up today&apos;s queue
                    </DropdownItem>
                    <DropdownItem
                      onSelect={async () => {
                        if (!window.confirm("Rebuild today's queue? Calls you already logged stay logged; only calls not yet made are replaced.")) return;
                        const r = await generate.run("today", true);
                        if (r?.ok) refresh();
                      }}
                    >
                      Rebuild today&apos;s queue
                    </DropdownItem>
                    <DropdownItem onSelect={async () => { const r = await generate.run("tomorrow", false); if (r?.ok) refresh(); }}>
                      <CalendarPlus /> Generate {tomorrowLabel}&apos;s queue
                    </DropdownItem>
                  </DropdownContent>
                </Dropdown>
              </>
            ) : null}
          </div>
        </CardBody>
        {tomorrowCount ? <p className="border-t border-border px-4 py-2 text-xs text-muted">{tomorrowCount} calls are already queued for {tomorrowLabel}.</p> : null}
      </Card>

      {!entries.length ? (
        <EmptyState
          icon={<Phone />}
          title="No calls queued for today"
          action={canEdit ? <Button variant="primary" disabled={generate.pending} onClick={async () => { const r = await generate.run("today", false); if (r?.ok) refresh(); }}>Build today&apos;s queue</Button> : null}
        >
          The queue picks callbacks that are due first, then follow-ups, then high-priority prospects you haven&apos;t called, skipping anyone called in the last {retryDays} days.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="overflow-hidden lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto scrollbar-thin">
            <ol className="divide-y divide-border">
              {entries.map((e, i) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-2",
                      selected?.id === e.id && "bg-accent-soft",
                      e.status !== "PENDING" && "opacity-60",
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums", e.status === "DONE" ? "border-success bg-success text-white" : "border-border text-muted")}>
                      {e.status === "DONE" ? <Check className="size-3" /> : e.status === "SKIPPED" ? <SkipForward className="size-3" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.company.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {e.status === "DONE" && e.outcome ? CALL_OUTCOME_LABEL[e.outcome] : e.status === "SKIPPED" ? "Skipped" : e.reason ?? e.company.industry}
                      </span>
                    </span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle" />
                  </button>
                </li>
              ))}
            </ol>
          </Card>

          {selected ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
              <div className="flex min-w-0 flex-col gap-4">
                <Card>
                  <CardBody className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold">{selected.company.name}</h2>
                        <p className="text-sm text-muted">
                          {[selected.company.industry, selected.company.subindustry, selected.company.location, selected.company.employeeCount ? `${selected.company.employeeCount} employees` : null].filter(Boolean).join(" · ")}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <StageBadge stage={selected.company.stage} />
                          <PriorityBadge priority={selected.company.priority} />
                          <ScoreBadge score={selected.company.score} estimate={selected.company.scoreIsEstimate} />
                          <Badge tone="outline">{selected.company.callCount ? `${selected.company.callCount} previous calls` : "First call"}</Badge>
                          {selected.company.lastContacted ? <Badge tone="outline">Last contact {selected.company.lastContacted}</Badge> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm"><Link href={`/leads/${selected.company.id}`}><ExternalLink /> Profile</Link></Button>
                        {canEdit && selected.status === "PENDING" ? (
                          <Button variant="ghost" size="sm" disabled={skip.pending} onClick={async () => { const r = await skip.run(selected.id); if (r?.ok) { goNext(); refresh(); } }}>
                            <SkipForward /> Skip
                          </Button>
                        ) : null}
                        {canEdit && selected.status !== "PENDING" ? (
                          <Button variant="ghost" size="sm" disabled={restore.pending} onClick={async () => { const r = await restore.run(selected.id); if (r?.ok) refresh(); }}>
                            <RotateCcw /> Back in queue
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button variant="ghost" size="icon-sm" title="Remove from today's queue" disabled={remove.pending} onClick={async () => { const r = await remove.run(selected.id); if (r?.ok) { goNext(); refresh(); } }}>
                            <X />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {selected.phones.length ? (
                      <div className="flex flex-col gap-2">
                        {selected.phones.map((p) => (
                          <a
                            key={`${p.contactId}-${p.raw}`}
                            href={p.href ?? undefined}
                            onClick={() => {
                              setDialed({ raw: p.raw, contactId: p.contactId });
                              if (!timer.running) timer.start();
                            }}
                            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5 transition-colors hover:border-accent"
                          >
                            <span className="min-w-0">
                              <span className="block text-base font-semibold tabular-nums text-accent">{p.display}</span>
                              <span className="block truncate text-xs text-muted">{p.label}</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-sm font-medium text-accent"><Phone className="size-4" /> Call</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-warning">No working phone number on file. Add one on the profile, or skip.</p>
                    )}

                    <div className="flex items-center gap-2 text-sm">
                      <Timer className="size-4 text-muted" />
                      <span className="font-mono tabular-nums">{formatDuration(timer.seconds)}</span>
                      {timer.running ? (
                        <Button size="sm" variant="ghost" onClick={timer.pause}><Pause /> Stop timer</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={timer.start}><Play /> {timer.seconds ? "Resume" : "Start timer"}</Button>
                      )}
                      <span className="text-xs text-subtle">Starts when you tap a number.</span>
                    </div>

                    {selected.reason ? <p className="text-xs text-muted">Why today: {selected.reason}</p> : null}
                    {selected.company.nextTask ? (
                      <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
                        <span className="font-medium">{selected.company.nextTask.title}</span> · due {selected.company.nextTask.due}
                        {selected.company.nextTask.notes ? <p className="text-fg/80">{selected.company.nextTask.notes}</p> : null}
                      </div>
                    ) : null}
                    {selected.company.personalNote ? (
                      <div className="rounded-md bg-accent-soft px-3 py-2 text-sm"><span className="font-medium">Opening line:</span> {selected.company.personalNote}</div>
                    ) : null}
                    {selected.company.contacts.length ? (
                      <div className="text-sm">
                        <p className="mb-1 text-xs font-medium text-muted">Who to ask for</p>
                        <ul className="flex flex-wrap gap-1.5">
                          {selected.company.contacts.map((c) => (
                            <li key={c.id}><Badge tone={c.isDecisionMaker ? "accent" : "outline"}>{c.name}{c.title ? `, ${c.title}` : ""}</Badge></li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {selected.company.notes ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-xs font-medium text-muted">Notes</summary>
                        <p className="mt-1 whitespace-pre-wrap text-fg/90">{selected.company.notes}</p>
                      </details>
                    ) : null}
                    {selected.company.recent.length ? (
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted">Recent activity</p>
                        <ul className="space-y-1 text-sm">
                          {selected.company.recent.map((a) => (
                            <li key={a.id} className="flex gap-2"><span className="w-14 shrink-0 text-xs text-subtle">{a.when}</span><span className="min-w-0">{a.summary}{a.body ? <span className="text-muted"> · {a.body.slice(0, 140)}</span> : null}</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardBody>
                </Card>

                {script ? (
                  <Card>
                    <CardHeader
                      title="Call script"
                      action={scripts.length > 1 ? (
                        <select className="select-chevron h-8 appearance-none bg-[length:14px] bg-[right_0.4rem_center] bg-no-repeat rounded-md border border-border bg-surface px-2 pr-7 text-xs" value={script.id} onChange={(e) => setScriptId(e.target.value)} aria-label="Choose a script">
                          {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : null}
                    />
                    <CardBody><pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-fg/90">{script.body}</pre></CardBody>
                  </Card>
                ) : null}
              </div>

              <Card className="h-fit xl:sticky xl:top-4">
                <CardHeader title="Log this call" description={selected.status === "DONE" ? "Already logged. You can log another call to the same prospect." : undefined} />
                <CardBody>
                  {canEdit ? (
                    <CallLogger
                      key={selected.id}
                      companyId={selected.company.id}
                      contacts={selected.company.contacts.map((c) => ({ id: c.id, name: c.name }))}
                      defaultContactId={dialed?.contactId ?? selected.contactId}
                      phoneDialed={dialed?.raw ?? selected.phones[0]?.raw ?? null}
                      queueItemId={selected.id}
                      retryDays={retryDays}
                      timer={timer}
                      compact
                      onLogged={() => {
                        goNext();
                        refresh();
                      }}
                    />
                  ) : (
                    <p className="text-sm text-muted">You have read-only access.</p>
                  )}
                </CardBody>
              </Card>
            </div>
          ) : (
            <EmptyState icon={<Check />} title="Queue finished">
              Nice work. Generate tomorrow&apos;s queue now so it&apos;s ready at lunch.
            </EmptyState>
          )}
        </div>
      )}
    </div>
  );
}

function GoalEditor({ goal, onSaved }: { goal: number; onSaved: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(String(goal));
  const { run, pending } = useServerAction(setDailyGoalAction);
  if (!editing) return <Button variant="ghost" onClick={() => setEditing(true)}>Goal: {goal}</Button>;
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(Number(value));
        if (r?.ok) {
          setEditing(false);
          onSaved();
        }
      }}
    >
      <Input className="h-9 w-20" type="number" min={1} max={200} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Daily call goal" autoFocus />
      <Button type="submit" variant="primary" disabled={pending}>Save</Button>
    </form>
  );
}
