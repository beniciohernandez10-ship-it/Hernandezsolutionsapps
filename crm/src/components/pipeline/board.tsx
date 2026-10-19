"use client";

import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { AlarmClock, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { changeStageAction } from "@/app/(app)/leads/actions";
import { PriorityBadge, ScoreBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/form";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/lib/constants";
import { usd } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface BoardCard {
  id: string;
  name: string;
  industry: string;
  city: string | null;
  stage: string;
  priority: string;
  score: number | null;
  scoreIsEstimate: boolean;
  monthly: number;
  weighted: number;
  probability: number;
  owner: string | null;
  next: string | null;
  overdue: boolean;
  daysInStage: number;
}

const COLLAPSIBLE = new Set(["CLOSED_WON", "CLOSED_LOST", "NOT_INTERESTED", "FUTURE_OPPORTUNITY"]);
const STORAGE_KEY = "hs-pipeline-hidden";

export function PipelineBoard({ cards: initial, canEdit }: { cards: BoardCard[]; canEdit: boolean }) {
  const router = useRouter();
  const [cards, setCards] = React.useState(initial);
  React.useEffect(() => setCards(initial), [initial]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [hidden, setHidden] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setHidden(JSON.parse(saved));
    } catch {}
  }, []);
  const toggleHidden = (key: string) => {
    setHidden((h) => {
      const next = h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const move = async (id: string, stage: string) => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === stage) return;
    const before = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage, daysInStage: 0 } : c)));
    const r = await changeStageAction(id, stage);
    if (!r?.ok) {
      setCards(before);
      toast(r?.error ?? "Couldn't move that prospect.", "danger");
      return;
    }
    toast(`${card.name} moved to ${STAGE_LABEL[stage]}.`);
    router.refresh();
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) void move(String(e.active.id), String(e.over.id));
  };
  const active = cards.find((c) => c.id === activeId) ?? null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 scrollbar-thin md:-mx-6 md:px-6">
        <div className="flex min-h-[60vh] gap-3">
          {PIPELINE_STAGES.map((s) => {
            const list = cards.filter((c) => c.stage === s.key);
            const isHidden = hidden.includes(s.key);
            return (
              <Column
                key={s.key}
                id={s.key}
                label={s.label}
                cards={list}
                collapsed={isHidden}
                collapsible={COLLAPSIBLE.has(s.key) || list.length === 0}
                onToggle={() => toggleHidden(s.key)}
                canEdit={canEdit}
                onMove={move}
              />
            );
          })}
        </div>
      </div>
      <DragOverlay>{active ? <CardView card={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  id, label, cards, collapsed, collapsible, onToggle, canEdit, onMove,
}: {
  id: string; label: string; cards: BoardCard[]; collapsed: boolean; collapsible: boolean; onToggle: () => void; canEdit: boolean; onMove: (id: string, stage: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canEdit });
  const monthly = cards.reduce((s, c) => s + c.monthly, 0);
  const weighted = cards.reduce((s, c) => s + c.weighted, 0);
  if (collapsed) {
    return (
      <div ref={setNodeRef} className={cn("flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-surface-2 py-2", isOver && "border-accent bg-accent-soft")}>
        <Button variant="ghost" size="icon-sm" onClick={onToggle} title={`Show ${label}`}><Eye /></Button>
        <span className="text-xs font-medium text-muted [writing-mode:vertical-rl]">{label} · {cards.length}</span>
      </div>
    );
  }
  return (
    <section ref={setNodeRef} aria-label={label} className={cn("flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-2 transition-colors", isOver && "border-accent bg-accent-soft")}>
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{label} <span className="font-normal text-muted">{cards.length}</span></h2>
          <p className="text-[11px] text-muted">{usd(monthly)}/mo · {usd(weighted)} weighted</p>
        </div>
        {collapsible ? <Button variant="ghost" size="icon-sm" onClick={onToggle} title={`Hide ${label}`}><EyeOff /></Button> : null}
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 scrollbar-thin lg:max-h-[calc(100vh-20rem)]">
        {cards.map((c) => <DraggableCard key={c.id} card={c} canEdit={canEdit} onMove={onMove} />)}
        {!cards.length ? <p className="px-1 py-6 text-center text-xs text-subtle">Drop here</p> : null}
      </div>
    </section>
  );
}

function DraggableCard({ card, canEdit, onMove }: { card: BoardCard; canEdit: boolean; onMove: (id: string, stage: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: !canEdit });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-40")}>
      <CardView card={card} canEdit={canEdit} onMove={onMove} />
    </div>
  );
}

function CardView({ card, dragging, canEdit, onMove }: { card: BoardCard; dragging?: boolean; canEdit?: boolean; onMove?: (id: string, stage: string) => void }) {
  return (
    <article className={cn("rounded-md border border-border bg-surface p-2.5 text-sm shadow-xs", dragging ? "cursor-grabbing shadow-lg ring-2 ring-accent" : canEdit && "cursor-grab")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${card.id}`} className="min-w-0 font-medium leading-5 hover:underline" onPointerDown={(e) => e.stopPropagation()}>
          {card.name}
        </Link>
        <ScoreBadge score={card.score} estimate={card.scoreIsEstimate} />
      </div>
      <p className="mt-0.5 truncate text-xs text-muted">{[card.industry, card.city].filter(Boolean).join(" · ")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={card.priority} />
        {card.monthly ? <span className="text-xs tabular-nums text-fg/80">{usd(card.monthly)}/mo</span> : null}
        {card.next ? (
          <span className={cn("ml-auto flex items-center gap-1 text-xs", card.overdue ? "text-danger" : "text-muted")}>
            <AlarmClock className="size-3" /> {card.next}
          </span>
        ) : null}
      </div>
      {card.daysInStage >= 14 ? <p className="mt-1 text-[11px] text-warning">{card.daysInStage} days in this stage</p> : null}
      {canEdit && onMove ? (
        <label className="mt-2 block md:hidden">
          <span className="sr-only">Move to stage</span>
          <select
            className="select-chevron h-7 w-full rounded border border-border bg-surface px-2 pr-7 text-xs"
            value={card.stage}
            onChange={(e) => onMove(card.id, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      ) : null}
    </article>
  );
}
