import { notFound, redirect } from "next/navigation";
import { ClientForm } from "@/components/clients/client-form";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { dayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { monthlyValue, num } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { convertToClientAction } from "../../actions";

export const metadata = { title: "Convert to client" };

export default async function ConvertPage({ params }: { params: Promise<{ companyId: string }> }) {
  const user = await requireUser("SALES");
  const { companyId } = await params;
  const company = await db.company.findUnique({ where: { id: companyId }, include: { contacts: { select: { id: true, name: true, isPrimary: true } }, client: { select: { id: true } } } });
  if (!company) notFound();
  if (company.client) redirect(`/clients/${company.client.id}`);
  const [sales, users] = await Promise.all([getSetting("sales"), db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const price = num(company.pricePerUser) ?? sales.pricePerUser;
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Convert ${company.name} to a client`} description="Creates the client record with an onboarding checklist, marks the deal Closed Won and stops any email sequences." />
      <Card>
        <CardBody>
          <ClientForm
            action={convertToClientAction.bind(null, company.id)}
            values={{
              contractStart: dayKey(),
              renewalDate: "",
              managedUsers: company.managedUsers,
              monthlyValue: company.managedUsers || num(company.monthlyValueOverride) !== null ? monthlyValue(company, sales.pricePerUser) : null,
              implementationFee: num(company.implementationFee),
              primaryContactId: company.contacts.find((c) => c.isPrimary)?.id ?? null,
              tenantDomain: null,
              tenantId: null,
              serviceScope: null,
              technicianId: user.id,
            }}
            contacts={company.contacts}
            users={users}
            pricePerUser={price}
            submitLabel="Convert to client"
          />
        </CardBody>
      </Card>
    </div>
  );
}
