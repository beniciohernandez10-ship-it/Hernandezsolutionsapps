"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Ban, Columns3, Mail, Phone, PhoneCall } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { enrollAction } from "@/app/(app)/outreach/actions";
import { bulkUpdateAction } from "@/app/(app)/leads/actions";
import { PriorityBadge, ScoreBadge, StageBadge, VerificationIcon } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { useServerAction } from "@/components/ui/form";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { BUSINESS_STAGES, CONTACT_METHOD_LABEL, INDUSTRIES, INDUSTRY_LABEL, PIPELINE_STAGES, PRIORITIES, REGION_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { usd } from "@/lib/money";
import { formatPhone, telHref } from "@/lib/normalize";
import { cn } from "@/lib/utils";

export interface LeadRow {
  id: string;
  name: string;
  industry: string;
  subindustry: string | null;
  businessStage: string;
  city: string | null;
  state: string | null;
  region: string | null;
  headquarters: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactCount: number;
  phone: string | null;
  phoneStatus: string;
  email: string | null;
  emailStatus: string;
  contactMethod: string;
  stage: string;
  priority: string;
  score: number | null;
  scoreIsEstimate: boolean;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  owner: string | null;
  employeeCount: number | null;
  monthly: number | null;
  tags: string[];
  doNotContact: boolean;
}

const SORTABLE: Record<string, string> = { name: "name", score: "score", priority: "priority", stage: "stage", location: "city", next: "next", last: "last", employees: "employees" };

export function LeadsTable(props: {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  users: { id: string; name: string }[];
  sequences?: { id: string; name: string }[];
  canEdit: boolean;
  now: string;
  todayStart: string;
}) {
  const { rows, total, page, pageSize, sort, dir, canEdit } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [visibility, setVisibility] = React.useState<VisibilityState>({ owner: false, employees: false, monthly: false, last: false });
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("hs-lead-columns");
      if (saved) setVisibility(JSON.parse(saved));
    } catch {}
  }, []);
  React.useEffect(() => setSelection({}), [rows]);

  const setParam = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    router.push(`${pathname}?${next.toString()}`);
  };

  const sortHeader = (key: string, label: string) => {
    const s = SORTABLE[key];
    const active = sort === s;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setParam({ sort: s, dir: active && dir === "desc" ? "asc" : "desc", page: undefined })}>
        {label} <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    );
  };

  const now = new Date(props.now).getTime();
  const todayStart = new Date(props.todayStart).getTime();

  const columns: ColumnDef<LeadRow>[] = [
    {
      id: "select",
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox aria-label="Select all on this page" checked={table.getIsAllPageRowsSelected()} onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)} />
      ),
      cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.name}`} checked={row.getIsSelected()} onChange={(e) => row.toggleSelected(e.target.checked)} />,
    },
    {
      id: "name",
      enableHiding: false,
      header: () => sortHeader("name", "Company"),
      cell: ({ row: { original: r } }) => (
        <div className="min-w-48">
          <Link href={`/leads/${r.id}`} className="font-medium text-fg hover:text-accent hover:underline">{r.name}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
            <span>{INDUSTRY_LABEL[r.industry] ?? r.industry}</span>
            {r.businessStage === "STARTUP" ? <Badge tone="accent">Startup</Badge> : null}
            {r.doNotContact ? <Badge tone="danger"><Ban /> Do not contact</Badge> : null}
          </div>
        </div>
      ),
    },
    {
      id: "location",
      header: () => sortHeader("location", "Location"),
      cell: ({ row: { original: r } }) => (
        <div className="min-w-28 text-sm">
          <div>{r.city ? `${r.city}${r.state ? `, ${r.state}` : ""}` : r.headquarters ?? <span className="text-subtle">—</span>}</div>
          {r.region ? <div className="text-xs text-muted">{REGION_LABEL[r.region]}</div> : null}
        </div>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: ({ row: { original: r } }) => (
        <div className="min-w-40 text-sm">
          {r.contactName ? (
            <>
              <div>{r.contactName}{r.contactCount > 1 ? <span className="text-xs text-subtle"> +{r.contactCount - 1}</span> : null}</div>
              {r.contactTitle ? <div className="text-xs text-muted">{r.contactTitle}</div> : null}
            </>
          ) : (
            <span className="text-xs text-subtle">{r.contactMethod !== "UNKNOWN" ? CONTACT_METHOD_LABEL[r.contactMethod] : "No named contact"}</span>
          )}
        </div>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      cell: ({ row: { original: r } }) => {
        const href = telHref(r.phone);
        return r.phone ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm">
            {href ? <a href={href} className="text-accent hover:underline">{formatPhone(r.phone)}</a> : r.phone}
            <VerificationIcon status={r.phoneStatus} />
          </span>
        ) : <span className="text-subtle">—</span>;
      },
    },
    {
      id: "email",
      header: "Email",
      cell: ({ row: { original: r } }) =>
        r.email ? (
          <span className="inline-flex max-w-56 items-center gap-1 text-sm">
            <a href={`mailto:${r.email}`} className="truncate text-accent hover:underline">{r.email}</a>
            <VerificationIcon status={r.emailStatus} />
          </span>
        ) : <span className="text-subtle">—</span>,
    },
    { id: "stage", header: () => sortHeader("stage", "Stage"), cell: ({ row: { original: r } }) => <StageBadge stage={r.stage} /> },
    { id: "priority", header: () => sortHeader("priority", "Priority"), cell: ({ row: { original: r } }) => <PriorityBadge priority={r.priority} /> },
    { id: "score", header: () => sortHeader("score", "Score"), cell: ({ row: { original: r } }) => <ScoreBadge score={r.score} estimate={r.scoreIsEstimate} /> },
    {
      id: "next",
      header: () => sortHeader("next", "Next follow-up"),
      cell: ({ row: { original: r } }) => {
        if (!r.nextFollowUpAt) return <span className="text-subtle">—</span>;
        const t = new Date(r.nextFollowUpAt).getTime();
        return <span className={cn("whitespace-nowrap text-sm", t < todayStart ? "font-medium text-danger" : t < now + 86_400_000 ? "text-warning" : "")}>{formatDate(r.nextFollowUpAt, { month: "short", day: "numeric" })}</span>;
      },
    },
    { id: "last", header: () => sortHeader("last", "Last contacted"), cell: ({ row: { original: r } }) => <span className="whitespace-nowrap text-sm">{formatDate(r.lastContactedAt, { month: "short", day: "numeric" })}</span> },
    { id: "employees", header: () => sortHeader("employees", "Employees"), cell: ({ row: { original: r } }) => <span className="text-sm tabular-nums">{r.employeeCount ?? "—"}</span> },
    { id: "monthly", header: "Est. monthly", cell: ({ row: { original: r } }) => <span className="text-sm tabular-nums">{r.monthly ? usd(r.monthly) : "—"}</span> },
    { id: "owner", header: "Owner", cell: ({ row: { original: r } }) => <span className="text-sm">{r.owner ?? "—"}</span> },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    state: { rowSelection: selection, columnVisibility: visibility },
    onRowSelectionChange: setSelection,
    onColumnVisibilityChange: (updater) => {
      setVisibility((old) => {
        const next = typeof updater === "function" ? updater(old) : updater;
        try {
          localStorage.setItem("hs-lead-columns", JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: canEdit,
  });

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          {total.toLocaleString()} prospect{total === 1 ? "" : "s"}
          {total > pageSize ? ` · showing ${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()}` : ""}
        </span>
        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="sm" className="hidden md:inline-flex"><Columns3 /> Columns</Button>
          </DropdownTrigger>
          <DropdownContent>
            <DropdownLabel>Show columns</DropdownLabel>
            {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
              <DropdownItem key={c.id} onSelect={(e) => { e.preventDefault(); c.toggleVisibility(); }}>
                <Checkbox readOnly checked={c.getIsVisible()} tabIndex={-1} />
                {COLUMN_LABEL[c.id] ?? c.id}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
      </div>

      {selectedIds.length ? <BulkBar ids={selectedIds} users={props.users} sequences={props.sequences ?? []} onDone={() => { setSelection({}); router.refresh(); }} /> : null}

      {rows.length === 0 ? (
        <EmptyState title="No prospects match">Try clearing a filter, or add prospects with the Import page or the Add prospect button.</EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface shadow-xs scrollbar-thin md:block">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-surface-2 text-xs font-medium text-muted">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} className={cn("whitespace-nowrap border-b border-border px-3 py-2.5 font-medium", h.id === "select" && "w-10")}>
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className={cn("border-b border-border last:border-0 hover:bg-surface-2/60", row.getIsSelected() && "bg-accent-soft/50")}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5 align-top">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => {
              const tel = telHref(r.phone);
              return (
                <li key={r.id} className="rounded-lg border border-border bg-surface p-3 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/leads/${r.id}`} className="min-w-0">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="truncate text-xs text-muted">
                        {INDUSTRY_LABEL[r.industry]} · {r.city ?? r.headquarters ?? "Location unknown"}
                      </p>
                    </Link>
                    <ScoreBadge score={r.score} estimate={r.scoreIsEstimate} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StageBadge stage={r.stage} />
                    <PriorityBadge priority={r.priority} />
                    {r.businessStage === "STARTUP" ? <Badge tone="accent">Startup</Badge> : null}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {tel ? (
                      <Button asChild variant="subtle" size="sm"><a href={tel}><Phone /> Call</a></Button>
                    ) : <Button variant="secondary" size="sm" disabled><Phone /> No phone</Button>}
                    {r.email ? (
                      <Button asChild variant="secondary" size="sm"><a href={`mailto:${r.email}`}><Mail /> Email</a></Button>
                    ) : <Button asChild variant="secondary" size="sm"><Link href={`/leads/${r.id}`}>Open</Link></Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted">Rows per page</span>
            <Select className="h-8 w-20" value={pageSize} onChange={(e) => setParam({ size: e.target.value, page: undefined })}>
              {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>Previous</Button>
            <span className="text-muted">Page {page} of {pages}</span>
            <Button size="sm" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const COLUMN_LABEL: Record<string, string> = {
  location: "Location", contact: "Contact", phone: "Phone", email: "Email", stage: "Stage", priority: "Priority", score: "Score",
  next: "Next follow-up", last: "Last contacted", employees: "Employees", monthly: "Est. monthly", owner: "Owner",
};

function BulkBar({ ids, users, sequences, onDone }: { ids: string[]; users: { id: string; name: string }[]; sequences: { id: string; name: string }[]; onDone: () => void }) {
  const { run, pending } = useServerAction(bulkUpdateAction);
  const enroll = useServerAction(enrollAction);
  const [op, setOp] = React.useState("stage");
  const [value, setValue] = React.useState("");
  const apply = async (o = op, v = value) => {
    const r = await run({ ids, op: o, value: v });
    if (r?.ok) onDone();
  };
  const options: Record<string, readonly { key: string; label: string }[] | null> = {
    stage: PIPELINE_STAGES,
    priority: PRIORITIES,
    industry: INDUSTRIES,
    businessStage: BUSINESS_STAGES,
    owner: [{ key: "none", label: "Unassigned" }, ...users.map((u) => ({ key: u.id, label: u.name }))],
    addTag: null,
    removeTag: null,
  };
  return (
    <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm shadow-sm">
      <span className="font-medium text-accent">{ids.length} selected</span>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => apply("queueToday", "")}>
        <PhoneCall /> Add to today&apos;s calls
      </Button>
      <span className="mx-1 hidden h-5 w-px bg-accent/30 sm:block" />
      <Select className="h-8 w-40" value={op} onChange={(e) => { setOp(e.target.value); setValue(""); }} aria-label="Bulk change">
        <option value="stage">Set stage</option>
        <option value="priority">Set priority</option>
        <option value="industry">Set industry</option>
        <option value="businessStage">Set startup/established</option>
        <option value="owner">Assign to</option>
        <option value="addTag">Add tag</option>
        <option value="removeTag">Remove tag</option>
      </Select>
      {options[op] ? (
        <Select className="h-8 w-48" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value">
          <option value="">Choose…</option>
          {options[op]!.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
      ) : (
        <Input className="h-8 w-40" value={value} onChange={(e) => setValue(e.target.value)} placeholder="tag" aria-label="Tag" />
      )}
      <Button size="sm" disabled={pending || !value} onClick={() => apply()}>Apply</Button>
      <Dropdown>
        <DropdownTrigger asChild><Button size="sm" variant="ghost">More</Button></DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => apply("doNotContact", "true")}>Mark do not contact</DropdownItem>
          <DropdownItem onSelect={() => apply("doNotContact", "false")}>Clear do not contact</DropdownItem>
          {sequences.length ? <DropdownSeparator /> : null}
          {sequences.map((sq) => (
            <DropdownItem
              key={sq.id}
              disabled={enroll.pending}
              onSelect={async () => {
                if (!window.confirm(`Add ${ids.length} prospect${ids.length === 1 ? "" : "s"} to "${sq.name}"? First emails are drafted for your approval; nothing is sent yet.`)) return;
                const r = await enroll.run({ companyIds: ids, sequenceId: sq.id });
                if (r?.ok) onDone();
              }}
            >
              Add to sequence: {sq.name}
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem onSelect={() => apply("archive", "")}>Archive</DropdownItem>
          <DropdownItem onSelect={() => apply("unarchive", "")}>Restore from archive</DropdownItem>
          <DropdownSeparator />
          <DropdownItem asChild><a href={`/api/export/leads?ids=${ids.join(",")}&format=csv`}>Export selected (CSV)</a></DropdownItem>
          <DropdownItem asChild><a href={`/api/export/leads?ids=${ids.join(",")}&format=xlsx`}>Export selected (Excel)</a></DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
  );
}
