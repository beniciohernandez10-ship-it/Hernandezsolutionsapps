"use client";

import { ArrowDown, ArrowUp, Pause, Play, Plus, Save, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteSequenceAction, saveSequenceAction, setEnrollmentStatusAction } from "@/app/(app)/outreach/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useServerAction } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";

interface Step { delayDays: number; templateId: string | null; sameThread: boolean }

export function SequenceEditor({ sequence, templates }: { sequence: { id: string; name: string; description: string | null; active: boolean; steps: Step[] } | null; templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = React.useState(sequence?.name ?? "");
  const [description, setDescription] = React.useState(sequence?.description ?? "");
  const [active, setActive] = React.useState(sequence?.active ?? true);
  const [steps, setSteps] = React.useState<Step[]>(sequence?.steps ?? [{ delayDays: 0, templateId: null, sameThread: false }, { delayDays: 3, templateId: null, sameThread: true }]);
  const save = useServerAction(saveSequenceAction);
  const del = useServerAction(deleteSequenceAction);
  const update = (i: number, p: Partial<Step>) => setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...p } : st)));
  const swap = (i: number, j: number) => setSteps((s) => { const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  return (
    <Card className="max-w-3xl">
      <CardBody className="flex flex-col gap-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard 4-email sequence" /></Field>
        <Field label="Description" hint="Optional"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Emails</p>
          {steps.map((st, i) => (
            <div key={i} className="grid items-end gap-3 rounded-md border border-border p-3 sm:grid-cols-[90px_1fr_auto]">
              <Field label={i === 0 ? "Start after (days)" : "Wait (days)"}>
                <Input type="number" min={0} max={90} value={st.delayDays} onChange={(e) => update(i, { delayDays: Number(e.target.value) })} />
              </Field>
              <Field label={`Email ${i + 1}`}>
                <Select value={st.templateId ?? ""} onChange={(e) => update(i, { templateId: e.target.value || null })}>
                  <option value="">{i === 0 ? "Automatic: first email for the prospect's industry" : `Automatic: built-in follow-up ${Math.min(i, 3)}`}</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Move up"><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" disabled={i === steps.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move down"><ArrowDown /></Button>
                <Button size="icon-sm" variant="danger-ghost" disabled={steps.length === 1} onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 /></Button>
              </div>
              {i > 0 ? (
                <label className="flex items-center gap-2 text-xs text-muted sm:col-span-3">
                  <Checkbox checked={st.sameThread} onChange={(e) => update(i, { sameThread: e.target.checked })} /> Send as a reply in the same thread (&ldquo;Re: &hellip;&rdquo;)
                </label>
              ) : null}
            </div>
          ))}
          {steps.length < 10 ? (
            <Button variant="ghost" className="self-start" onClick={() => setSteps((s) => [...s, { delayDays: 5, templateId: null, sameThread: true }])}><Plus /> Add email</Button>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Turned on</label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={save.pending}
            onClick={async () => {
              const r = await save.run(sequence?.id ?? null, { name, description, active, steps });
              if (r?.ok) router.push("/outreach/sequences");
            }}
          >
            <Save /> Save sequence
          </Button>
          {sequence ? (
            <Button variant="danger-ghost" disabled={del.pending} onClick={async () => { if (window.confirm("Delete this sequence?")) { const r = await del.run(sequence.id); if (r?.ok) router.push("/outreach/sequences"); } }}>
              <Trash2 /> Delete
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted">Editing a sequence affects prospects already in it from their next email onward.</p>
      </CardBody>
    </Card>
  );
}

export function EnrollmentControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { run, pending } = useServerAction(setEnrollmentStatusAction);
  const go = async (s: "ACTIVE" | "PAUSED" | "STOPPED") => { const r = await run(id, s); if (r?.ok) router.refresh(); };
  if (status === "ACTIVE") {
    return (
      <span className="inline-flex gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => go("PAUSED")}><Pause /> Pause</Button>
        <Button size="sm" variant="danger-ghost" disabled={pending} onClick={() => { if (window.confirm("Stop this sequence for this prospect? Unsent drafts are cancelled.")) void go("STOPPED"); }}><Square /> Stop</Button>
      </span>
    );
  }
  if (status === "PAUSED") return <Button size="sm" variant="ghost" disabled={pending} onClick={() => go("ACTIVE")}><Play /> Resume</Button>;
  return null;
}
