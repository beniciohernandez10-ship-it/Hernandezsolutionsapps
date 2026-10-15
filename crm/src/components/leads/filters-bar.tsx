"use client";

import { Bookmark, Download, SlidersHorizontal, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { deleteViewAction, saveViewAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { useServerAction } from "@/components/ui/form";
import { Field, Input, Select, Checkbox } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { INDUSTRIES, PIPELINE_STAGES, PRIORITIES, REGIONS } from "@/lib/constants";
import type { LeadFilters } from "@/lib/leads/filters";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "general", label: "General" },
  { key: "startups", label: "Startups" },
  { key: "veterinary", label: "Veterinary" },
  { key: "all", label: "Everything" },
] as const;

export function LeadFiltersBar({ filters, users, views }: { filters: LeadFilters; users: { id: string; name: string }[]; views: { id: string; name: string; filters: Record<string, string> }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(filters.q ?? "");
  const save = useServerAction(saveViewAction);
  const del = useServerAction(deleteViewAction);

  const update = React.useCallback(
    (patch: Record<string, string | string[] | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        const s = Array.isArray(v) ? v.join(",") : v;
        if (s) next.set(k, s);
        else next.delete(k);
      }
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  React.useEffect(() => setQ(filters.q ?? ""), [filters.q]);

  const advancedCount = [filters.city, filters.state, filters.zip, filters.scoreMin, filters.contact, filters.followUp, filters.owner, filters.tag, filters.archived ? "1" : ""].filter(Boolean).length;
  const anyFilter = filters.q || filters.industry.length || filters.region.length || filters.stage.length || filters.priority.length || advancedCount;
  const exportQuery = params.toString();

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border bg-surface p-0.5 shadow-xs" role="tablist" aria-label="Prospect list">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={filters.view === v.key}
              onClick={() => update({ view: v.key === "general" ? undefined : v.key })}
              className={cn("rounded px-3 py-1.5 text-sm", filters.view === v.key ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg")}
            >
              {v.label}
            </button>
          ))}
        </div>
        <form
          className="min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || undefined });
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, city, contact, email, phone, notes…" aria-label="Search prospects" />
        </form>
        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="secondary"><Bookmark /> Views</Button>
          </DropdownTrigger>
          <DropdownContent className="w-64">
            <DropdownLabel>Saved views</DropdownLabel>
            {views.length === 0 ? <p className="px-2 py-1.5 text-xs text-subtle">No saved views yet.</p> : null}
            {views.map((v) => (
              <div key={v.id} className="flex items-center">
                <DropdownItem asChild className="flex-1">
                  <Link href={`/leads?${new URLSearchParams(v.filters).toString()}`}>{v.name}</Link>
                </DropdownItem>
                <button className="rounded p-1.5 text-subtle hover:text-danger" aria-label={`Delete ${v.name}`} onClick={() => void del.run(v.id).then(() => router.refresh())}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <DropdownSeparator />
            <DropdownItem
              disabled={save.pending}
              onSelect={() => {
                const name = window.prompt("Name this view (for example: Orange County CPA firms)");
                if (name) void save.run(name, params.toString()).then(() => router.refresh());
              }}
            >
              <Bookmark /> Save current filters as a view
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="secondary"><Download /> Export</Button>
          </DropdownTrigger>
          <DropdownContent>
            <DropdownItem asChild><a href={`/api/export/leads?${exportQuery}&format=csv`}>CSV (current filters)</a></DropdownItem>
            <DropdownItem asChild><a href={`/api/export/leads?${exportQuery}&format=xlsx`}>Excel (current filters)</a></DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect label="Industry" options={INDUSTRIES} value={filters.industry} onChange={(v) => update({ industry: v })} searchable />
        <MultiSelect label="Region" options={REGIONS} value={filters.region} onChange={(v) => update({ region: v })} />
        <MultiSelect label="Stage" options={PIPELINE_STAGES} value={filters.stage} onChange={(v) => update({ stage: v })} searchable />
        <MultiSelect label="Priority" options={PRIORITIES} value={filters.priority} onChange={(v) => update({ priority: v })} />
        <AdvancedFilters filters={filters} users={users} onApply={update} count={advancedCount} />
        {anyFilter ? (
          <Button variant="ghost" size="sm" onClick={() => router.push(filters.view === "general" ? pathname : `${pathname}?view=${filters.view}`)}>
            <X /> Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AdvancedFilters({ filters, users, onApply, count }: { filters: LeadFilters; users: { id: string; name: string }[]; onApply: (p: Record<string, string | undefined>) => void; count: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className={cn(count && "border-accent/50 bg-accent-soft text-accent")}>
          <SlidersHorizontal /> More filters {count ? `(${count})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent title="More filters" description="Custom geography, contact quality, follow-ups and more.">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const get = (k: string) => (String(fd.get(k) ?? "").trim() || undefined);
            onApply({
              city: get("city"),
              state: get("state"),
              zip: get("zip"),
              scoreMin: get("scoreMin"),
              contact: get("contact"),
              followUp: get("followUp"),
              owner: get("owner"),
              tag: get("tag")?.toLowerCase(),
              archived: fd.get("archived") ? "1" : undefined,
            });
            setOpen(false);
          }}
        >
          <Field label="City"><Input name="city" defaultValue={filters.city} placeholder="Irvine" /></Field>
          <Field label="State"><Input name="state" defaultValue={filters.state} placeholder="CA" /></Field>
          <Field label="ZIP starts with" hint="For example 926 for much of Orange County"><Input name="zip" defaultValue={filters.zip} inputMode="numeric" /></Field>
          <Field label="Minimum score"><Input name="scoreMin" type="number" min={0} max={100} defaultValue={filters.scoreMin} /></Field>
          <Field label="Contact information">
            <Select name="contact" defaultValue={filters.contact ?? ""}>
              <option value="">Any</option>
              <option value="has_email">Has an email</option>
              <option value="has_phone">Has a phone</option>
              <option value="verified_email">Has a verified email</option>
              <option value="verified_phone">Has a verified phone</option>
              <option value="needs_verification">Needs verification</option>
              <option value="no_contact">No email or phone</option>
            </Select>
          </Field>
          <Field label="Next follow-up">
            <Select name="followUp" defaultValue={filters.followUp ?? ""}>
              <option value="">Any</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">In the next 7 days</option>
              <option value="none">None scheduled</option>
            </Select>
          </Field>
          <Field label="Assigned to">
            <Select name="owner" defaultValue={filters.owner ?? ""}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Tag"><Input name="tag" defaultValue={filters.tag} placeholder="beverly-hills-startups-technology" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox name="archived" defaultChecked={filters.archived} /> Show archived prospects instead
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="submit" variant="primary">Apply</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
