import { notFound } from "next/navigation";
import { LeadForm } from "@/components/leads/lead-form";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { updateLeadAction } from "../../actions";

export const metadata = { title: "Edit prospect" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("SALES");
  const { id } = await params;
  const [c, users, sales] = await Promise.all([
    db.company.findUnique({ where: { id } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getSetting("sales"),
  ]);
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`Edit ${c.name}`} />
      <LeadForm
        action={updateLeadAction.bind(null, c.id)}
        users={users}
        submitLabel="Save changes"
        cancelHref={`/leads/${c.id}`}
        defaultPrice={sales.pricePerUser}
        values={{
          ...c,
          pricePerUser: num(c.pricePerUser),
          monthlyValueOverride: num(c.monthlyValueOverride),
          implementationFee: num(c.implementationFee),
          expectedCloseDate: c.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
        }}
      />
    </>
  );
}
