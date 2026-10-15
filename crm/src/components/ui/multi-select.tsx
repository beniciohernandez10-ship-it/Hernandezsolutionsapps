"use client";

import { Check, ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  searchable,
}: {
  label: string;
  options: readonly { key: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = React.useState("");
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm shadow-xs hover:bg-surface-2",
          value.length && "border-accent/50 bg-accent-soft text-accent",
        )}
      >
        {label}
        {value.length ? <span className="rounded bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{value.length}</span> : null}
        <ChevronDown className="size-3.5 opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-64 rounded-md border border-border bg-surface p-1 shadow-lg">
          {searchable ? (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Find ${label.toLowerCase()}…`}
              className="mb-1 h-8 w-full rounded border border-border bg-surface-2 px-2 text-sm focus:outline-none"
            />
          ) : null}
          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            {shown.map((o) => {
              const on = value.includes(o.key);
              return (
                <button key={o.key} type="button" onClick={() => toggle(o.key)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2">
                  <span className={cn("flex size-4 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  {o.label}
                </button>
              );
            })}
          </div>
          {value.length ? (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted hover:bg-surface-2">
              Clear
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
