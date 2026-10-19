import { CheckCircle2, CircleDashed, CircleHelp, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABEL, STAGE_LABEL, VERIFICATION_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STAGE_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger" | "outline"> = {
  NEW_LEAD: "outline",
  RESEARCHING: "outline",
  READY_TO_CONTACT: "neutral",
  ATTEMPTED_CONTACT: "neutral",
  CONTACTED: "accent",
  FOLLOW_UP_REQUIRED: "warning",
  INTERESTED: "accent",
  DISCOVERY_SCHEDULED: "accent",
  DISCOVERY_COMPLETED: "accent",
  ASSESSMENT: "accent",
  PROPOSAL_DRAFTING: "accent",
  PROPOSAL_SENT: "accent",
  NEGOTIATION: "accent",
  CONTRACT_SENT: "accent",
  CLOSED_WON: "success",
  CLOSED_LOST: "danger",
  NOT_INTERESTED: "neutral",
  FUTURE_OPPORTUNITY: "outline",
};

export function StageBadge({ stage, className }: { stage: string; className?: string }) {
  return <Badge tone={STAGE_TONE[stage] ?? "neutral"} className={className}>{STAGE_LABEL[stage] ?? stage}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const tone = priority === "HIGH" ? "danger" : priority === "LOW" ? "neutral" : "warning";
  return (
    <Badge tone={tone}>
      <span className={cn("size-1.5 rounded-full", priority === "HIGH" ? "bg-danger" : priority === "LOW" ? "bg-subtle" : "bg-warning")} />
      {PRIORITY_LABEL[priority] ?? priority}
    </Badge>
  );
}

export function ScoreBadge({ score, estimate }: { score: number | null; estimate?: boolean }) {
  if (score === null || score === undefined) return <span className="text-subtle">—</span>;
  const tone = score >= 70 ? "success" : score >= 40 ? "accent" : "neutral";
  return (
    <Badge tone={tone} title={estimate ? "Estimate: some factors are inferred or unknown" : "Based on recorded evidence"}>
      {score}
      {estimate ? <span className="font-normal opacity-70">est.</span> : null}
    </Badge>
  );
}

export function VerificationIcon({ status, className }: { status: string; className?: string }) {
  const label = VERIFICATION_LABEL[status] ?? status;
  const Icon = status === "VERIFIED" ? CheckCircle2 : status === "INVALID" ? XCircle : status === "UNVERIFIED" ? CircleDashed : CircleHelp;
  return (
    <span title={label} aria-label={label} className={cn("inline-flex", status === "VERIFIED" ? "text-success" : status === "INVALID" ? "text-danger" : "text-subtle", className)}>
      <Icon className="size-3.5" />
    </span>
  );
}
