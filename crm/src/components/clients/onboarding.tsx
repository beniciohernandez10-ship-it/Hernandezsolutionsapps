"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { editOnboardingAction, setClientActiveAction, setOnboardingItemAction } from "@/app/(app)/clients/actions";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";

export function OnboardingChecklist({ clientId, items, canEdit }: { clientId: string; items: { label: string; done: boolean; doneAt: string | null }[]; canEdit: boolean }) {
  const router = useRouter();
  const toggle = useServerAction(setOnboardingItemAction);
  const edit = useServerAction(editOnboardingAction);
  const [newItem, setNewItem] = React.useState("");
  const [optimistic, setOptimistic] = React.useState<Record<number, boolean>>({});
  React.useEffect(() => setOptimistic({}), [items]);
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <div key={`${i}-${item.label}`} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={optimistic[i] ?? item.done}
            disabled={!canEdit}
            onChange={async (e) => {
              const checked = e.target.checked;
              setOptimistic((o) => ({ ...o, [i]: checked }));
              const r = await toggle.run(clientId, i, checked);
              if (r?.ok) router.refresh();
              else setOptimistic((o) => { const n = { ...o }; delete n[i]; return n; });
            }}
            aria-label={item.label}
          />
          <span className={(optimistic[i] ?? item.done) ? "flex-1 text-sm text-muted line-through" : "flex-1 text-sm"}>{item.label}</span>
          {item.doneAt ? <span className="text-xs text-subtle">{formatDate(item.doneAt, { month: "short", day: "numeric" })}</span> : null}
          {canEdit ? (
            <button type="button" className="invisible text-subtle hover:text-danger group-hover:visible" aria-label={`Remove ${item.label}`} onClick={async () => { if (window.confirm(`Remove "${item.label}"?`)) { const r = await edit.run(clientId, { remove: i }); if (r?.ok) router.refresh(); } }}>
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newItem.trim()) return;
            const r = await edit.run(clientId, { add: newItem });
            if (r?.ok) { setNewItem(""); router.refresh(); }
          }}
        >
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a checklist item" />
          <Button type="submit" disabled={edit.pending}><Plus /> Add</Button>
        </form>
      ) : null}
    </div>
  );
}

export function ClientActiveToggle({ clientId, active }: { clientId: string; active: boolean }) {
  const router = useRouter();
  const { run, pending } = useServerAction(setClientActiveAction);
  return (
    <Button
      variant={active ? "ghost" : "secondary"}
      disabled={pending}
      onClick={async () => {
        if (active && !window.confirm("Mark this client inactive? Its revenue stops counting as contracted.")) return;
        const r = await run(clientId, !active);
        if (r?.ok) router.refresh();
      }}
    >
      {active ? "Mark inactive" : "Mark active"}
    </Button>
  );
}
