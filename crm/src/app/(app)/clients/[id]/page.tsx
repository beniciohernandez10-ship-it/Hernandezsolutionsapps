import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientActiveToggle, OnboardingChecklist } from "@/components/clients/onboarding";
import { ClientForm } from "@/components/clients/client-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader, Progress } from "@/components/ui/misc";
import { canAdmin, canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { formatDate, toLocalInput } from "@/lib/dates";
import { db } from "@/lib/db";
import { num, usd } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { updateClientAction } from "../actions";

export const metadata = { title: "Client" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const client = await db.client.findUnique({ where: { id }, include: { company: { include: { contacts: { select: { id: true, name: true, email: true, phone: true, title: true } } } } } });
  if (!client) notFound();
  const [sales, users] = await Promise.all([getSetting("sales"), db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const items = (client.onboarding as { label: string; done: boolean; doneAt: string | null }[]) ?? [];
  const done = items.filter((i) => i.done).length;
  const primary = client.company.contacts.find((c) => c.id === client.primaryContactId);
  const edit = canWrite(user.role);
  return (
    <div>
      <PageHeader
        title={client.company.name}
        description={<>Client since {formatDate(client.contractStart, { month: "long", day: "numeric", year: "numeric" })} · <Link href={`/leads/${client.companyId}`} className="text-accent hover:underline">Full history</Link></>}
        actions={canAdmin(user.role) ? <ClientActiveToggle clientId={client.id} active={client.active} /> : null}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Onboarding" description={`${done} of ${items.length} done`} />
            <CardBody>
              <Progress value={done} max={items.length || 1} className="mb-4" />
              <OnboardingChecklist clientId={client.id} items={items} canEdit={edit} />
            </CardBody>
          </Card>
          {edit ? (
            <Card>
              <CardHeader title="Contract details" />
              <CardBody>
                <ClientForm
                  action={updateClientAction.bind(null, client.id)}
                  values={{
                    contractStart: toLocalInput(client.contractStart).slice(0, 10),
                    renewalDate: client.renewalDate ? toLocalInput(client.renewalDate).slice(0, 10) : "",
                    managedUsers: client.managedUsers,
                    monthlyValue: num(client.monthlyValue),
                    implementationFee: num(client.implementationFee),
                    primaryContactId: client.primaryContactId,
                    tenantDomain: client.tenantDomain,
                    tenantId: client.tenantId,
                    serviceScope: client.serviceScope,
                    technicianId: client.technicianId,
                  }}
                  contacts={client.company.contacts}
                  users={users}
                  pricePerUser={num(client.company.pricePerUser) ?? sales.pricePerUser}
                  submitLabel="Save changes"
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
        <Card className="h-fit">
          <CardHeader title="Summary" />
          <CardBody>
            <dl>
              <KeyValue label="Monthly">{usd(num(client.monthlyValue), { cents: true })}</KeyValue>
              <KeyValue label="Annual">{usd((num(client.monthlyValue) ?? 0) * 12)}</KeyValue>
              <KeyValue label="Implementation">{usd(num(client.implementationFee))}</KeyValue>
              <KeyValue label="Managed users">{client.managedUsers}</KeyValue>
              <KeyValue label="Primary contact">{primary ? `${primary.name}${primary.title ? `, ${primary.title}` : ""}` : "—"}</KeyValue>
              <KeyValue label="Tenant domain">{client.tenantDomain ?? "—"}</KeyValue>
              <KeyValue label="Tenant ID">{client.tenantId ? <code className="text-xs">{client.tenantId}</code> : "—"}</KeyValue>
              <KeyValue label="Status">{client.active ? "Active" : "Inactive"}</KeyValue>
            </dl>
            {client.serviceScope ? <p className="mt-3 whitespace-pre-wrap text-sm">{client.serviceScope}</p> : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
