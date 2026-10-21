import { requirePrincipal } from "@/lib/auth/current";
import { canSeeOrgFor } from "@/lib/authz";
import { listDevices } from "@/lib/tickets/service";
import Link from "next/link";
import { PageTransition } from "@/components/page-transition";
import { listCatalog } from "@/lib/catalog/service";
import { CATEGORY_LABEL } from "@/lib/tickets/schemas";
import { NewTicketForm } from "./form";
import { aiCustomers } from "@/lib/ai/service";

export const metadata = { title: "New request" };

export default async function NewTicketPage() {
  const { principal } = await requirePrincipal("/portal/tickets/new");
  const orgs = principal.memberships.map((m) => ({ id: m.customerId, name: m.customerName }));
  const deviceCustomers = principal.memberships.filter((m) => canSeeOrgFor(principal, m.customerId));
  const catalog = await listCatalog(principal);
  const aiOrgs = [...(await aiCustomers(orgs.map((o) => o.id)))];
  const devices = deviceCustomers.length ? (await listDevices(principal)).devices.map((d) => ({ id: d.id, name: d.name, customerId: d.customerId })) : [];
  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">New request</p>
          <h1>How can we help?</h1>
        </div>
      </div>
      {orgs.length === 0 ? (
        <p className="muted">Your account isn&apos;t assigned to an organization, so you can&apos;t submit requests yet.</p>
      ) : (
        <>
          {catalog.length > 0 && (
            <section aria-labelledby="catalog-h" className="stack">
              <h2 id="catalog-h">Request something</h2>
              <ul className="catalog-grid" role="list">
                {catalog.map((i) => (
                  <li key={i.id}>
                    <Link className="card tight card-link catalog-tile" href={`/portal/catalog/${i.id}`} transitionTypes={["nav-forward"]}>
                      <span className="eyebrow">{CATEGORY_LABEL[i.category]}</span>
                      <strong>{i.name}</strong>
                      {i.summary && <span className="subtle">{i.summary}</span>}
                      {i.requiresApproval && <span className="subtle">Needs approval</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="problem-h" className="stack">
            <h2 id="problem-h">{catalog.length ? "Or report a problem" : "Report a problem"}</h2>
            <NewTicketForm orgs={orgs} devices={devices} aiOrgs={aiOrgs} />
          </section>
        </>
      )}
    </PageTransition>
  );
}
