import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/current";
import { getCatalogItem } from "@/lib/catalog/service";
import { AppError } from "@/lib/errors";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { CatalogRequestForm } from "./form";

export const metadata = { title: "Request" };

export default async function CatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal } = await requirePrincipal(`/portal/catalog/${id}`);
  let item;
  try {
    item = await getCatalogItem(principal, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const orgs = principal.memberships
    .filter((m) => !item.customerId || m.customerId === item.customerId)
    .map((m) => ({ id: m.customerId, name: m.customerName }));
  return (
    <PageTransition>
      <p>
        <Link href="/portal/tickets/new" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> New request
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">Request</p>
          <h1>{item.name}</h1>
          {item.summary && <p className="muted">{item.summary}</p>}
        </div>
      </div>
      {item.requiresApproval && (
        <p className="alert">
          <span>Your organization&apos;s administrator approves this before we start. We&apos;ll let you know either way.</span>
        </p>
      )}
      <CatalogRequestForm itemId={item.id} fields={item.fields} orgs={orgs} />
    </PageTransition>
  );
}
