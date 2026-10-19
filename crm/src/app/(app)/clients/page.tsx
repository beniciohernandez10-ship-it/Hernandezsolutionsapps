import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Progress, Stat } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { INDUSTRY_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { num, usd } from "@/lib/money";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireUser();
  const clients = await db.client.findMany({
    include: { company: { select: { id: true, name: true, industry: true, city: true } }, technician: { select: { name: true } } },
    orderBy: [{ active: "desc" }, { contractStart: "desc" }],
  });
  const active = clients.filter((c) => c.active);
  const mrr = active.reduce((s, c) => s + (num(c.monthlyValue) ?? 0), 0);
  const users = active.reduce((s, c) => s + c.managedUsers, 0);
  const soon = active.filter((c) => c.renewalDate && c.renewalDate.getTime() - Date.now() < 60 * 86400_000).length;
  return (
    <div>
      <PageHeader title="Clients" description="Signed clients. These are the only figures counted as contracted revenue." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><Stat label="Active clients" value={active.length} /></Card>
        <Card className="p-4"><Stat label="Contracted MRR" value={usd(mrr)} hint={`${usd(mrr * 12)} a year`} /></Card>
        <Card className="p-4"><Stat label="Managed users" value={users} /></Card>
        <Card className="p-4"><Stat label="Renewals in 60 days" value={soon} tone={soon ? "warning" : undefined} /></Card>
      </div>
      {!clients.length ? (
        <EmptyState icon={<BadgeCheck />} title="No clients yet">When a prospect signs, open their profile and choose Convert to client.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Users</th>
                <th className="px-4 py-2 font-medium">MRR</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Renewal</th>
                <th className="px-4 py-2 font-medium">Onboarding</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const items = (c.onboarding as { done: boolean }[]) ?? [];
                const done = items.filter((i) => i.done).length;
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.company.name}</Link>
                      {!c.active ? <Badge tone="neutral" className="ml-2">Inactive</Badge> : null}
                      <div className="text-xs text-muted">{INDUSTRY_LABEL[c.company.industry]}{c.company.city ? ` · ${c.company.city}` : ""}{c.technician ? ` · ${c.technician.name}` : ""}</div>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{c.managedUsers}</td>
                    <td className="px-4 py-2.5 tabular-nums">{usd(num(c.monthlyValue))}</td>
                    <td className="px-4 py-2.5">{formatDate(c.contractStart)}</td>
                    <td className="px-4 py-2.5">{c.renewalDate ? formatDate(c.renewalDate) : "—"}</td>
                    <td className="w-40 px-4 py-2.5"><Progress value={done} max={items.length || 1} /><span className="text-xs text-muted">{done} of {items.length}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
