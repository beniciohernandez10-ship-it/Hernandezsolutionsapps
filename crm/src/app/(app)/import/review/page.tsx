import Link from "next/link";
import { DuplicateActions } from "@/components/import/duplicate-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { INDUSTRY_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { db } from "@/lib/db";
import type { ImportRow } from "@/lib/import/types";

export const metadata = { title: "Review duplicates" };

const FIELDS: { label: string; existing: (c: Existing) => string | null | undefined; incoming: (r: ImportRow) => string | null | undefined }[] = [
  { label: "Name", existing: (c) => c.name, incoming: (r) => r.name },
  { label: "Lead ID", existing: (c) => c.externalId, incoming: (r) => r.externalId },
  { label: "Industry", existing: (c) => INDUSTRY_LABEL[c.industry], incoming: (r) => INDUSTRY_LABEL[r.industry] },
  { label: "Website", existing: (c) => c.website, incoming: (r) => r.website },
  { label: "Address", existing: (c) => [c.streetAddress, c.city, c.state, c.zip].filter(Boolean).join(", "), incoming: (r) => [r.streetAddress, r.city, r.state, r.zip].filter(Boolean).join(", ") || r.headquarters },
  { label: "Phone", existing: (c) => c.mainPhone, incoming: (r) => r.mainPhone },
  { label: "Email", existing: (c) => c.mainEmail, incoming: (r) => r.mainEmail },
  { label: "Contacts", existing: (c) => c.contacts.map((x) => x.name).join(", "), incoming: (r) => r.contacts.map((x) => x.name).join(", ") },
  { label: "Notes", existing: (c) => c.notes?.slice(0, 200), incoming: (r) => r.notes?.slice(0, 200) },
];

type Existing = NonNullable<Awaited<ReturnType<typeof load>>>[number]["company"];

function load() {
  return db.duplicateReview.findMany({
    where: { status: "OPEN" },
    include: { company: { include: { contacts: { select: { name: true } } } }, batch: { select: { fileName: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export default async function ReviewPage() {
  const user = await requireUser("SALES");
  const reviews = await load();
  return (
    <div>
      <PageHeader title="Review possible duplicates" description="These incoming records share some details with an existing prospect but not enough to be sure. Nothing was created for them yet." />
      {!reviews.length ? (
        <EmptyState title="Nothing to review" action={<Link href="/import" className="text-sm text-accent hover:underline">Back to Import</Link>}>All possible duplicates have been handled.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((rv) => {
            const row = rv.candidate as unknown as ImportRow;
            return (
              <Card key={rv.id}>
                <CardHeader
                  title={<>{row.name} <span className="font-normal text-muted">might be</span> <Link href={`/leads/${rv.companyId}`} className="hover:underline">{rv.company.name}</Link></>}
                  description={`${rv.reasons.join(", ")} · from ${rv.batch?.fileName ?? "an import"} row ${row.rowNumber}${rv.batch ? `, ${formatDate(rv.batch.createdAt)}` : ""}`}
                />
                <CardBody>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-muted"><tr><th className="w-28 py-1 font-medium" /><th className="py-1 font-medium">Existing prospect</th><th className="py-1 font-medium">Incoming record</th></tr></thead>
                      <tbody>
                        {FIELDS.map((f) => {
                          const a = f.existing(rv.company) || "";
                          const b = f.incoming(row) || "";
                          if (!a && !b) return null;
                          return (
                            <tr key={f.label} className="border-t border-border align-top">
                              <td className="py-1.5 pr-3 text-xs text-muted">{f.label}</td>
                              <td className="py-1.5 pr-3">{a || <span className="text-subtle">—</span>}</td>
                              <td className={a && b && a.toLowerCase() !== b.toLowerCase() ? "py-1.5 text-warning" : "py-1.5"}>{b || <span className="text-subtle">—</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {canWrite(user.role) ? <DuplicateActions id={rv.id} /> : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
