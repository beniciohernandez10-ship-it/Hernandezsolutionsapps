import Link from "next/link";
import { ViewTransition } from "react";
import type { TicketSummary } from "@/lib/tickets/service";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { Time } from "@/components/time";
import { IconInbox } from "@/components/icons";
import type { Priority } from "@/lib/tickets/schemas";

export function TicketList({ items, showCustomer, emptyText }: { items: TicketSummary[]; showCustomer: boolean; emptyText: string }) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <IconInbox size={28} />
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <ul className="ticket-list">
      {items.map((t) => (
        <li key={t.id}>
          <Link className="ticket-row" href={`/portal/tickets/${t.id}`} transitionTypes={["nav-forward"]}>
            <div>
              <ViewTransition name={`ticket-title-${t.id}`} share="morph" default="none">
                <div className="title">{t.title}</div>
              </ViewTransition>
              <div className="meta">
                <span className="ticket-number">#{t.number}</span>
                {showCustomer && <span>{t.customerName}</span>}
                <span>Requested by {t.requesterName}</span>
                <span>Updated <Time iso={t.updatedAt} /></span>
                {t.assigneeName && <span>Assigned to {t.assigneeName}</span>}
              </div>
            </div>
            <div className="row">
              <PriorityBadge priority={t.priority as Priority} />
              <StatusBadge status={t.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
