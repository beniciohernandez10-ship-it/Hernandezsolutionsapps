"use client";

import { Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { addFindingAction, decideFindingAction } from "@/app/(app)/leads/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton, toast, useServerAction } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { RESEARCH_FIELDS, RESEARCH_FIELD_LABEL, type ResearchField } from "@/lib/research-fields";

interface Finding {
  id: string;
  field: string;
  value: string;
  sourceUrl: string;
  sourceTitle: string | null;
  quote: string | null;
  retrievedAt: string;
  status: string;
}

export function ResearchPanel({ companyId, findings, editable, aiEnabled }: { companyId: string; findings: Finding[]; editable: boolean; aiEnabled: boolean }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const decide = useServerAction(decideFindingAction);
  const pending = findings.filter((f) => f.status === "PENDING");
  const decided = findings.filter((f) => f.status !== "PENDING");

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/research/${companyId}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; found?: number; discarded?: number };
      if (!res.ok) toast(body.error ?? "Research failed.", "danger");
      else toast(`Found ${body.found} sourced fact${body.found === 1 ? "" : "s"} to review${body.discarded ? ` (${body.discarded} without a checkable source were dropped)` : ""}.`);
      router.refresh();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="neutral">
        Every finding shows the page it came from and when. Nothing changes on the lead until you accept it, and contact details stay Unverified until you confirm them.
      </Alert>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          {aiEnabled ? (
            <Button variant="primary" onClick={run} disabled={running}>
              {running ? <Loader2 className="animate-spin" /> : <Sparkles />} {running ? "Researching (up to a few minutes)…" : "Research this company"}
            </Button>
          ) : (
            <span className="text-sm text-muted">The AI research assistant is off. Add an ANTHROPIC_API_KEY to turn it on. You can still record findings by hand below.</span>
          )}
        </div>
      ) : null}

      {pending.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">To review ({pending.length})</h3>
          {pending.map((f) => (
            <div key={f.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Badge tone="outline">{RESEARCH_FIELD_LABEL[f.field as ResearchField] ?? f.field}</Badge>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{f.value}</p>
                  {f.quote ? <blockquote className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted">“{f.quote}”</blockquote> : null}
                  <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent hover:underline">
                    <ExternalLink className="size-3 shrink-0" /> {f.sourceTitle || f.sourceUrl}
                  </a>
                  <p className="text-[11px] text-subtle">Retrieved {formatDate(f.retrievedAt)}</p>
                </div>
                {editable ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="subtle" disabled={decide.pending} onClick={async () => { await decide.run(f.id, true); router.refresh(); }}><Check /> Accept</Button>
                    <Button size="sm" variant="ghost" disabled={decide.pending} onClick={async () => { await decide.run(f.id, false); router.refresh(); }}><X /> Dismiss</Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {editable ? (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Record a finding by hand</summary>
          <ActionForm action={addFindingAction.bind(null, companyId)} resetOnSuccess onSuccess={() => router.refresh()} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="What it is">
              <Select name="field" defaultValue="website">
                {RESEARCH_FIELDS.map((k) => <option key={k} value={k}>{RESEARCH_FIELD_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="Value"><Input name="value" required /></Field>
            <Field label="Source link" hint="The page where you saw it" className="sm:col-span-2"><Input name="sourceUrl" type="url" required placeholder="https://" /></Field>
            <div className="flex justify-end sm:col-span-2"><SubmitButton size="sm">Save finding</SubmitButton></div>
          </ActionForm>
        </details>
      ) : null}

      {decided.length ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted">Reviewed findings ({decided.length})</summary>
          <ul className="mt-2 divide-y divide-border">
            {decided.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-muted">{RESEARCH_FIELD_LABEL[f.field as ResearchField] ?? f.field}:</span> {f.value}{" "}
                  <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline">source</a>
                </span>
                <Badge tone={f.status === "ACCEPTED" ? "success" : "neutral"}>{f.status === "ACCEPTED" ? "Accepted" : "Dismissed"}</Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!findings.length && !editable ? <p className="text-sm text-muted">No research yet.</p> : null}
    </div>
  );
}
