import { requirePrincipal } from "@/lib/auth/current";
import { capabilities, STAFF_ROLES } from "@/lib/authz";
import { emailIntakeEnabled } from "@/lib/config";
import { listInbox } from "@/lib/email/inbound";
import { PageTransition } from "@/components/page-transition";
import { IconMail } from "@/components/icons";
import { InboxItemCard } from "./item";

export const metadata = { title: "Email inbox" };

export default async function InboxPage() {
  const { principal } = await requirePrincipal("/portal/inbox");
  if (!capabilities(principal).manager) {
    return (
      <PageTransition>
        <h1>Email inbox</h1>
        <p className="muted">Only service managers review incoming email.</p>
      </PageTransition>
    );
  }
  const items = await listInbox(principal);
  const customers = principal.memberships.filter((m) => STAFF_ROLES.includes(m.role)).map((m) => ({ id: m.customerId, name: m.customerName }));
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service managers</p>
          <h1>Email inbox</h1>
        </div>
      </div>
      <p className="subtle">
        Emails that couldn&apos;t be matched safely to a request wait here: new conversations, replies from a different address, and anything that
        failed sender checks. Nothing here has been added to a ticket. Treat links and files in these emails with care.
      </p>
      {!emailIntakeEnabled() && (
        <p className="alert alert-warning">
          <span>Email intake isn&apos;t switched on yet, so nothing will arrive here. See docs/email-setup.md.</span>
        </p>
      )}
      {items.length === 0 ? (
        <div className="empty">
          <IconMail size={28} />
          <p>Nothing to review.</p>
        </div>
      ) : (
        <ul className="stack" role="list">
          {items.map((i) => (
            <li key={i.id}>
              <InboxItemCard item={i} customers={customers} />
            </li>
          ))}
        </ul>
      )}
    </PageTransition>
  );
}
