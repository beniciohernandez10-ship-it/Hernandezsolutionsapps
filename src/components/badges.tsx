import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status } from "@/lib/tickets/schemas";
import { IconAlert, IconArrowDown, IconArrowUp, IconBolt, IconCheck, IconDash, IconInfo, IconLock, IconOpen, IconProgress, IconResolved, IconWaiting } from "./icons";

/* Every badge pairs an icon and a text label with its color, so status,
   priority and compliance never rely on color alone. */

const STATUS_ICON = { open: IconOpen, in_progress: IconProgress, waiting: IconWaiting, resolved: IconResolved };

export function StatusBadge({ status }: { status: Status }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`badge status-${status}`}>
      <Icon size={13} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_ICON = { low: IconArrowDown, normal: IconDash, high: IconArrowUp, urgent: IconBolt };

export function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span className={`badge priority-${priority}`}>
      <Icon size={13} />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

const COMPLIANCE: Record<string, { label: string; Icon: typeof IconCheck }> = {
  compliant: { label: "Compliant", Icon: IconCheck },
  noncompliant: { label: "Not compliant", Icon: IconAlert },
  inGracePeriod: { label: "In grace period", Icon: IconWaiting },
  conflict: { label: "Conflict", Icon: IconAlert },
  error: { label: "Error", Icon: IconAlert },
  configManager: { label: "Managed by Configuration Manager", Icon: IconInfo },
  unknown: { label: "Unknown", Icon: IconInfo },
};

export function ComplianceBadge({ state }: { state: string | null }) {
  const c = COMPLIANCE[state ?? "unknown"] ?? COMPLIANCE.unknown;
  return (
    <span className={`badge compliance-${state ?? "unknown"}`}>
      <c.Icon size={13} />
      {c.label}
    </span>
  );
}

export function InternalBadge() {
  return (
    <span className="badge internal">
      <IconLock size={13} />
      Private note, technicians only
    </span>
  );
}

const SYNC: Record<string, { label: string; Icon: typeof IconCheck }> = {
  synchronized: { label: "Synchronized", Icon: IconCheck },
  pending: { label: "Syncing", Icon: IconProgress },
  failed: { label: "Last sync failed", Icon: IconAlert },
  needs_review: { label: "Needs review", Icon: IconAlert },
  never: { label: "Not synchronized yet", Icon: IconInfo },
};

export function SyncBadge({ status }: { status: string }) {
  const s = SYNC[status] ?? SYNC.never;
  return (
    <span className={`badge ${status === "failed" || status === "needs_review" ? "compliance-error" : status === "synchronized" ? "compliance-compliant" : ""}`}>
      <s.Icon size={13} />
      {s.label}
    </span>
  );
}
