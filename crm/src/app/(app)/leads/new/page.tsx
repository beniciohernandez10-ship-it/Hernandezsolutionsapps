import { LeadForm } from "@/components/leads/lead-form";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { createLeadAction } from "../actions";

export const metadata = { title: "Add prospect" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("SALES");
  const sp = await searchParams;
  const [users, sales] = await Promise.all([
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getSetting("sales"),
  ]);
  return (
    <>
      <PageHeader title="Add prospect" description="Only record facts you've seen. Duplicates are checked when you save." />
      <LeadForm
        action={createLeadAction}
        users={users}
        submitLabel="Create prospect"
        cancelHref="/leads"
        defaultPrice={sales.pricePerUser}
        values={{ ownerId: user.id, industry: sp.industry ?? "other", businessStage: sp.startup ? "STARTUP" : "UNKNOWN" }}
      />
    </>
  );
}
