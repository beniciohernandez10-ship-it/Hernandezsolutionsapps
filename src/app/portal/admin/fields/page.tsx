import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { listCustomersForOperator } from "@/lib/admin/service";
import { listFieldDefs } from "@/lib/fields/service";
import { PageTransition } from "@/components/page-transition";
import { IconBack } from "@/components/icons";
import { FieldsConsole } from "./console";

export const metadata = { title: "Ticket fields" };

export default async function FieldsPage() {
  const { principal } = await requirePrincipal("/portal/admin/fields");
  if (!principal.isOperator) {
    return (
      <PageTransition>
        <h1>Ticket fields</h1>
        <p className="muted">Only platform operators can manage ticket fields.</p>
      </PageTransition>
    );
  }
  const [fields, customers] = await Promise.all([listFieldDefs(principal), listCustomersForOperator(principal)]);
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
          <h1>Ticket fields</h1>
        </div>
      </div>
      <p className="subtle">
        Extra questions on the new-request form, for one client or all of them, and one category or all. Answers show on the ticket under
        &quot;More details&quot;, where technicians can change them. Technician-only fields are for your own notes and never shown to the client.
        Catalog requests use their own forms.
      </p>
      <FieldsConsole fields={fields} customers={(customers as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))} />
    </PageTransition>
  );
}
