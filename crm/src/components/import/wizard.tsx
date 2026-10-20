"use client";

import { ArrowLeft, ClipboardPaste, Eye, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { analyzeImportAction, runImportAction, type AnalyzeResult } from "@/app/(app)/import/actions";
import { PastePanel } from "@/components/import/paste-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Stat } from "@/components/ui/misc";
import { autoMap } from "@/lib/import/mapping";
import { PASTE_COLUMNS, pastedLeadsToCsv, type PastedLead } from "@/lib/import/paste";
import type { ImportReport } from "@/lib/import/types";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "preview" | "done";

export function ImportWizard({ fields, initialMode = "file" }: { fields: { key: string; label: string }[]; initialMode?: "file" | "paste" }) {
  const [step, setStep] = React.useState<Step>("upload");
  const [mode, setMode] = React.useState<"file" | "paste">(initialMode);
  const [pasteText, setPasteText] = React.useState("");
  const [pasteRows, setPasteRows] = React.useState<PastedLead[] | null>(null);
  const fromPaste = mode === "paste" && !!pasteRows;
  const [file, setFile] = React.useState<File | null>(null);
  const [analysis, setAnalysis] = React.useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [tags, setTags] = React.useState("");
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const formWith = (extra: Record<string, string>, f = file) => {
    const fd = new FormData();
    fd.set("file", f!);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };

  const analyze = (f: File) =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("file", f);
      const r = await analyzeImportAction(fd);
      if (!r?.ok) return setError(r?.error ?? "Couldn't read that file.");
      const a = r.data as AnalyzeResult;
      setAnalysis(a);
      setMapping(a.mapping as Record<string, string>);
      setTags(a.fileName.replace(/\.(csv|xlsx|xls|txt|tsv)$/i, "").replace(/[_]+/g, " ").slice(0, 40));
      setStep("map");
    });

  const run = (dryRun: boolean, override?: { file: File; mapping: Record<string, string>; tags: string }) =>
    start(async () => {
      setError(null);
      const r = await runImportAction(formWith({ mapping: JSON.stringify(override?.mapping ?? mapping), tags: override?.tags ?? tags, dryRun: dryRun ? "1" : "0" }, override?.file ?? file));
      if (!r?.ok) return setError(r?.error ?? "Import failed.");
      const rep = (r.data as { report: ImportReport }).report;
      setReport(rep);
      setStep(dryRun ? "preview" : "done");
      if (!dryRun) toast(`Imported: ${rep.created} created, ${rep.merged} merged${rep.flagged ? `, ${rep.flagged} to review` : ""}.`);
    });

  /** Reviewed paste rows go through the same pipeline as a file: duplicate checks, report, audit. */
  const previewPasted = (rows: PastedLead[]) => {
    const f = new File([pastedLeadsToCsv(rows)], `Pasted leads ${new Date().toISOString().slice(0, 10)}.csv`, { type: "text/csv" });
    const headers = PASTE_COLUMNS.map((c) => c.header);
    const m = autoMap(headers) as Record<string, string>;
    const t = tags || "pasted";
    setFile(f);
    setAnalysis({ fileName: f.name, headers, mapping: m, sample: [], rows: rows.length });
    setMapping(m);
    setTags(t);
    run(true, { file: f, mapping: m, tags: t });
  };

  const reset = () => { setStep("upload"); setFile(null); setAnalysis(null); setReport(null); setPasteRows(null); setPasteText(""); setTags(""); };
  const used = new Set(Object.values(mapping));

  return (
    <Card>
      <CardHeader
        title={step === "upload" ? (mode === "paste" ? (pasteRows ? "2. Check the sorted rows" : "1. Paste lead information") : "1. Upload a file") : step === "map" ? "2. Match your columns" : step === "preview" ? "3. Check the preview" : "Import finished"}
        description={analysis && step !== "upload" ? `${analysis.fileName} · ${analysis.rows} rows` : mode === "paste" ? "Contact details, business field, city, email and phone are sorted into columns for you." : "CSV or Excel (.xlsx or .xls), up to 4 MB."}
        action={step !== "upload" || pasteRows ? <Button size="sm" variant="ghost" onClick={reset}><ArrowLeft /> Start over</Button> : null}
      />
      <CardBody className="flex flex-col gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {step === "upload" && !pasteRows ? (
          <div className="flex gap-1 rounded-md bg-surface-2 p-1" role="group" aria-label="Import from">
            <Button size="sm" variant={mode === "file" ? "secondary" : "ghost"} aria-pressed={mode === "file"} onClick={() => setMode("file")}><FileUp /> Upload a file</Button>
            <Button size="sm" variant={mode === "paste" ? "secondary" : "ghost"} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}><ClipboardPaste /> Paste text</Button>
          </div>
        ) : null}

        {step === "upload" && mode === "paste" ? (
          <PastePanel
            text={pasteText}
            setText={setPasteText}
            rows={pasteRows}
            setRows={setPasteRows}
            pending={pending}
            onSpreadsheet={(t) => { setMode("file"); const f = new File([t], "Pasted rows.tsv", { type: "text/tab-separated-values" }); setFile(f); analyze(f); }}
            onPreview={previewPasted}
          />
        ) : null}

        {step === "upload" && mode === "file" ? (
          <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-12 text-center hover:border-accent", pending && "opacity-60")}>
            <Upload className="size-8 text-subtle" />
            <span className="text-sm font-medium">{pending ? "Reading…" : "Choose a file"}</span>
            <span className="text-xs text-muted">Nothing is saved until you confirm the import.</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.txt,.tsv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  analyze(f);
                }
              }}
            />
          </label>
        ) : null}

        {step === "map" && analysis ? (
          <>
            <p className="text-sm text-muted">Columns we recognized are filled in. Leave a field empty if your file doesn&apos;t have it. Extra columns that aren&apos;t matched are ignored.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[f.key] = e.target.value; else delete n[f.key]; return n; })}
                    className={cn(f.key === "name" && !mapping.name && "border-danger")}
                  >
                    <option value="">—</option>
                    {analysis.headers.map((h) => (
                      <option key={h} value={h} disabled={used.has(h) && mapping[f.key] !== h}>{h}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            <Field label="Tag these leads" hint="Optional, comma separated. Helps you find this batch later.">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            {analysis.sample.length ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">First rows of your file</summary>
                <div className="mt-2 overflow-x-auto rounded border border-border">
                  <table className="text-xs">
                    <thead className="bg-surface-2"><tr>{analysis.headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                    <tbody>{analysis.sample.map((r, i) => <tr key={i} className="border-t border-border">{analysis.headers.map((h) => <td key={h} className="max-w-48 truncate px-2 py-1">{r[h]}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </details>
            ) : null}
            <div className="flex gap-2">
              <Button variant="primary" disabled={pending || !mapping.name} onClick={() => run(true)}><Eye /> {pending ? "Checking…" : "Preview import"}</Button>
            </div>
          </>
        ) : null}

        {(step === "preview" || step === "done") && report ? (
          <>
            {step === "preview" ? <Alert tone="accent">This is a preview. Nothing has been saved yet.</Alert> : null}
            {step === "done" ? (
              <Alert tone={report.confirmedInDatabase === report.created ? "success" : "danger"} title={report.confirmedInDatabase === report.created ? "Import complete" : "Some records didn't save"}>
                {report.confirmedInDatabase} of {report.created} new prospects confirmed in the database.
              </Alert>
            ) : null}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={step === "preview" ? "Would be created" : "Created"} value={report.created} tone="success" />
              <Stat label="Merged into existing" value={report.merged} />
              <Stat label="Held for review" value={report.flagged} tone={report.flagged ? "warning" : undefined} />
              <Stat label="Skipped" value={report.skipped} />
            </div>
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="mb-1 font-medium">Missing information ({report.totalRecords} records)</p>
              <p className="text-muted">
                No email: {report.missing.email} · No phone: {report.missing.phone} · No location: {report.missing.location} · No contact name: {report.missing.contactName} · No website: {report.missing.website} · Industry unrecognized: {report.missing.industry}
              </p>
              <p className="mt-1 text-muted">{report.contactsCreated} contacts {step === "preview" ? "would be" : "were"} added. Nothing missing was filled in or guessed.</p>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface-2"><tr><th className="px-2 py-1.5 font-medium">Row</th><th className="px-2 py-1.5 font-medium">Company</th><th className="px-2 py-1.5 font-medium">Result</th><th className="px-2 py-1.5 font-medium">Details</th></tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={`${r.rowNumber}-${r.result}`} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 tabular-nums">{r.rowNumber}</td>
                      <td className="px-2 py-1.5">{r.companyId && step === "done" && r.result !== "flagged" ? <Link href={`/leads/${r.companyId}`} className="hover:underline">{r.name}</Link> : r.name || "—"}</td>
                      <td className="px-2 py-1.5"><Badge tone={r.result === "created" ? "success" : r.result === "flagged" ? "warning" : r.result === "skipped" ? "outline" : "neutral"}>{r.result === "flagged" ? "review" : r.result}</Badge></td>
                      <td className="px-2 py-1.5 text-muted">{[r.matchedName ? `matches "${r.matchedName}"` : null, ...(r.reasons ?? []), ...(r.warnings ?? [])].filter(Boolean).join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {step === "preview" ? (
              <div className="flex gap-2">
                <Button variant="primary" disabled={pending} onClick={() => run(false)}><Upload /> {pending ? "Importing…" : `Import ${report.created + report.merged} records`}</Button>
                <Button variant="ghost" onClick={() => setStep(fromPaste ? "upload" : "map")}>{fromPaste ? "Back to rows" : "Back to columns"}</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button asChild variant="primary"><Link href="/leads?view=all&sort=created&dir=desc">View prospects</Link></Button>
                {report.flagged ? <Button asChild variant="secondary"><Link href="/import/review">Review {report.flagged} possible duplicates</Link></Button> : null}
              </div>
            )}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
