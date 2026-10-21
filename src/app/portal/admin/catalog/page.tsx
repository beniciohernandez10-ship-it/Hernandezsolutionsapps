import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listCustomersForOperator } from "@/lib/admin/service";
import { listCatalogForOperator } from "@/lib/catalog/service";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { CatalogConsole } from "./console";

export const metadata = { title: "Service catalog" };

export default async function CatalogAdminPage() {
  const { principal } = await requirePrincipal("/portal/admin/catalog");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Service catalog</h1>
        <p className="muted">Only platform operators can manage the catalog.</p>
      </PageTransition>
    );
  }
  const [items, customers] = await Promise.all([listCatalogForOperator(principal), listCustomersForOperator(principal)]);
  return (
    <PageTransition>
      <p>
        <Link href="/portal/admin" transitionTypes={["nav-back"]} className="subtle">
          <IconBack size={14} /> Administration
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">Platform operator</p>
          <h1>Service catalog</h1>
        </div>
      </div>
      <p className="subtle">
        Request types clients can choose from New request. Each has its own questions and a checklist for technicians. Items that need approval
        wait for the client&apos;s administrator. The starter items are templates; edit them to match how you work.
      </p>
      <CatalogConsole items={items} customers={(customers as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))} />
    </PageTransition>
  );
}
