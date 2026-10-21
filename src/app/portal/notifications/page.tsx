import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listNotifications } from "@/lib/notify/service";
import { describeNotification } from "@/lib/email/templates";
import { PageTransition } from "@/components/page-transition";
import { Time } from "@/components/time";
import { IconBell } from "@/components/icons";
import { MarkAllRead } from "./mark-all";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { principal } = await requirePrincipal("/portal/notifications");
  const items = principal.memberships.length ? await listNotifications(principal, 100) : [];
  const unread = items.filter((n) => !n.read).length;
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Updates on your requests</p>
          <h1>Notifications</h1>
        </div>
        <div className="row">
          {unread > 0 && <MarkAllRead />}
          <Link className="btn btn-ghost" href="/portal/settings" transitionTypes={["nav-forward"]}>Email settings</Link>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <IconBell size={28} />
          <p>Nothing yet. Replies, status changes and assignments will show up here.</p>
        </div>
      ) : (
        <ul className="notification-list" role="list">
          {items.map((n) => (
            <li key={n.id} className={n.read ? "" : "unread"}>
              <Link href={n.href} transitionTypes={["nav-forward"]}>
                <span className="title">
                  {!n.read && <span className="sr-only">Unread: </span>}
                  <span className="ticket-number">{n.ref}</span> {n.ticketTitle}
                </span>
                <span className="subtle">
                  {describeNotification(n.kind, n.actorName, n.detail)} · <Time iso={n.createdAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageTransition>
  );
}
