"use client";

import { Eye, Plus, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { looksLikeSpreadsheet, PASTE_COLUMNS, sortPastedLeads, type PastedLead } from "@/lib/import/paste";
import { cn } from "@/lib/utils";

const blank = (): PastedLead => ({
  company: "", contactName: "", title: "", businessField: "", fieldInferred: false, street: "", city: "", state: "", zip: "",
  email: "", phone: "", website: "", linkedin: "", notes: "",
});

/** The main columns stay visible; the rest open per row. */
const MAIN = new Set(["company", "contactName", "title", "businessField", "city", "state", "email", "phone"]);

export function PastePanel({
  text,
  setText,
  rows,
  setRows,
  pending,
  onSpreadsheet,
  onPreview,
}: {
  text: string;
  setText: (t: string) => void;
  rows: PastedLead[] | null;
  setRows: (r: PastedLead[] | null) => void;
  pending: boolean;
  onSpreadsheet: (text: string) => void;
  onPreview: (rows: PastedLead[]) => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);

  const sort = () => {
    setError(null);
    if (looksLikeSpreadsheet(text)) return onSpreadsheet(text);
    try {
      const found = sortPastedLeads(text);
      if (!found.length) return setError("Couldn't find any businesses, emails or phone numbers in that text.");
      setRows(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that text.");
    }
  };

  const edit = (i: number, key: keyof PastedLead, value: string) =>
    setRows(rows!.map((r, j) => (j === i ? { ...r, [key]: value, ...(key === "businessField" ? { fieldInferred: false } : {}) } : r)));

  if (!rows)
    return (
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          aria-label="Pasted lead information"
          placeholder={"Paste anything: a directory listing, a website's contact page, an email signature, or rows from a spreadsheet.\n\nBayview Animal Hospital\nDr. Maria Lopez, Owner\n1234 Main St, Oakland, CA 94607\n(510) 555-0142 · info@bayviewvet.com\n\nPut a blank line between businesses, or one business per line."}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || !text.trim()} onClick={sort}><Sparkles /> Sort it</Button>
          <span className="text-xs text-muted">Nothing is saved yet. You&apos;ll check every row first.</span>
        </div>
      </div>
    );

  const missingName = rows.filter((r) => !r.company.trim()).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Found {rows.length} {rows.length === 1 ? "business" : "businesses"}. Fix anything that landed in the wrong column. Empty cells stay empty; nothing is filled in for you.
        {rows.some((r) => r.fieldInferred) ? <> A <Badge tone="outline">guess</Badge> business field was read from the company name.</> : null}
      </p>
      {missingName ? <Alert tone="warning">{missingName} row{missingName === 1 ? " has" : "s have"} no company name and will be skipped. Type one in, or remove the row.</Alert> : null}
      <div className="max-h-[32rem] overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              {PASTE_COLUMNS.filter((c) => MAIN.has(c.key)).map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">{c.label}</th>)}
              <th className="px-2 py-1.5"><span className="sr-only">Row actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <React.Fragment key={i}>
                <tr className="border-t border-border align-top">
                  {PASTE_COLUMNS.filter((c) => MAIN.has(c.key)).map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      <div className="relative">
                        <Input
                          value={r[c.key]}
                          onChange={(e) => edit(i, c.key, e.target.value)}
                          aria-label={`${c.label}, row ${i + 1}`}
                          className={cn("h-8 min-w-28 text-xs", c.key === "state" && "min-w-14", c.key === "company" && !r.company.trim() && "border-danger", c.key === "businessField" && r.fieldInferred && "pr-12")}
                        />
                        {c.key === "businessField" && r.fieldInferred ? <Badge tone="outline" className="pointer-events-none absolute right-1 top-1.5">guess</Badge> : null}
                      </div>
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-1 py-1">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{open === i ? "Less" : "More"}</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setOpen(null); }}><Trash2 /></Button>
                  </td>
                </tr>
                {open === i ? (
                  <tr className="bg-surface-2/50">
                    <td colSpan={MAIN.size + 1} className="px-2 py-2">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {PASTE_COLUMNS.filter((c) => !MAIN.has(c.key)).map((c) => (
                          <label key={c.key} className="flex flex-col gap-1 text-xs">
                            <span className="text-muted">{c.label}</span>
                            <Input value={r[c.key]} onChange={(e) => edit(i, c.key, e.target.value)} className="h-8 text-xs" />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending || rows.length === missingName} onClick={() => onPreview(rows)}><Eye /> {pending ? "Checking…" : "Preview import"}</Button>
        <Button variant="secondary" onClick={() => setRows([...rows, blank()])}><Plus /> Add a row</Button>
        <Button variant="ghost" onClick={() => setRows(null)}>Edit the pasted text</Button>
      </div>
    </div>
  );
}
