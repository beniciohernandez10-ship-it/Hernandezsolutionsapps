"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Eye, EyeOff, GripVertical, LayoutGrid, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { resetDashboardLayoutAction, saveDashboardLayoutAction } from "@/app/(app)/dashboard-actions";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export interface WidgetDef {
  id: string;
  title: string;
  node: React.ReactNode;
}

export interface LayoutItem {
  id: string;
  visible: boolean;
  wide?: boolean;
}

export function DashboardGrid({ widgets, layout: initial }: { widgets: WidgetDef[]; layout: LayoutItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [layout, setLayout] = React.useState(initial);
  React.useEffect(() => setLayout(initial), [initial]);
  const save = useServerAction(saveDashboardLayoutAction);
  const reset = useServerAction(resetDashboardLayoutAction);
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setLayout((l) => {
      const from = l.findIndex((i) => i.id === e.active.id);
      const to = l.findIndex((i) => i.id === e.over!.id);
      return arrayMove(l, from, to);
    });
  };
  const patch = (id: string, p: Partial<LayoutItem>) => setLayout((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const shown = editing ? layout : layout.filter((i) => i.visible);

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        {editing ? (
          <>
            <Button variant="ghost" disabled={reset.pending} onClick={async () => { const r = await reset.run(); if (r?.ok) { setEditing(false); router.refresh(); } }}>
              <RotateCcw /> Reset
            </Button>
            <Button variant="ghost" onClick={() => { setLayout(initial); setEditing(false); }}>Cancel</Button>
            <Button variant="primary" disabled={save.pending} onClick={async () => { const r = await save.run(layout); if (r?.ok) setEditing(false); }}>
              <Check /> Save layout
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setEditing(true)}><LayoutGrid /> Customize</Button>
        )}
      </div>
      {editing ? <p className="mb-3 text-sm text-muted">Drag widgets to reorder them, hide the ones you don&apos;t need, and make any widget full width.</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shown.map((item) => {
              const w = byId.get(item.id);
              if (!w) return null;
              return <Tile key={item.id} item={item} widget={w} editing={editing} onPatch={patch} />;
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Tile({ item, widget, editing, onPatch }: { item: LayoutItem; widget: WidgetDef; editing: boolean; onPatch: (id: string, p: Partial<LayoutItem>) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editing });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("min-w-0", item.wide && "lg:col-span-2", isDragging && "z-10 opacity-80", editing && !item.visible && "opacity-50")}
    >
      {editing ? (
        <div className="mb-1 flex items-center gap-1 rounded-t-md border border-b-0 border-dashed border-accent/50 bg-accent-soft px-2 py-1 text-xs">
          <button type="button" className="flex cursor-grab items-center gap-1 font-medium active:cursor-grabbing" {...attributes} {...listeners} aria-label={`Move ${widget.title}`}>
            <GripVertical className="size-4" /> {widget.title}
          </button>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => onPatch(item.id, { wide: !item.wide })}>{item.wide ? <><Minimize2 /> Half</> : <><Maximize2 /> Full width</>}</Button>
            <Button size="sm" variant="ghost" onClick={() => onPatch(item.id, { visible: !item.visible })}>{item.visible ? <><EyeOff /> Hide</> : <><Eye /> Show</>}</Button>
          </span>
        </div>
      ) : null}
      <div className={cn(editing && "pointer-events-none select-none")}>{widget.node}</div>
    </div>
  );
}
