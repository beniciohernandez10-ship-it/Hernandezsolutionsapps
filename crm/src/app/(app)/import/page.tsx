import { Download, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { ImportWizard } from "@/components/import/wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { IMPORT_FIELDS } from "@/lib/import/mapping";
import type { ImportReport } from "@/lib/import/types";

export const metadata = { title: "Import & Export" };

export default async function ImportPage() {
  await requireUser("SALES");
  const [batches, openReviews] = await Promise.all([
    db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { createdBy: { select: { name: true } } } }),
    db.duplicateReview.count({ where: { status: "OPEN" } }),
  ]);
  return (
    <div>
      <PageHeader title="Import & Export" description="Add leads from CSV or Excel. Imports only add or fill in; they never delete or overwrite what's already here." />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <ImportWizard fields={IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label }))} />
        <div className="flex flex-col gap-4">
          {openReviews ? (
            <Card className="border-warning/40">
              <CardHeader title="Possible duplicates to review" />
              <CardBody>
                <p className="mb-3 text-sm">{openReviews} incoming record{openReviews === 1 ? " looks" : "s look"} like an existing prospect. They weren&apos;t created; decide what to do with each.</p>
                <Button asChild variant="primary"><Link href="/import/review">Review duplicates</Link></Button>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Templates" description="Headers the importer recognizes automatically." />
            <CardBody className="flex flex-wrap gap-2">
              <Button asChild variant="secondary"><a href="/api/import/template?format=xlsx"><FileSpreadsheet /> Excel template</a></Button>
              <Button asChild variant="secondary"><a href="/api/import/template?format=csv"><Download /> CSV template</a></Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Export" description="Same columns as the template, so you can edit in Excel and re-import." />
            <CardBody className="flex flex-col gap-2">
              <Button asChild variant="secondary"><a href="/api/export/leads?view=all&format=xlsx"><FileSpreadsheet /> All prospects (Excel)</a></Button>
              <Button asChild variant="secondary"><a href="/api/export/leads?view=all&format=csv"><Download /> All prospects (CSV)</a></Button>
              <p className="text-xs text-muted">To export a filtered list or a selection, use the export buttons on the Prospects page.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent imports" />
            {batches.length ? (
              <ul className="divide-y divide-border text-sm">
                {batches.map((b) => {
                  const r = b.report as Partial<ImportReport>;
                  return (
                    <li key={b.id} className="px-4 py-2.5">
                      <p className="truncate font-medium">{b.fileName}</p>
                      <p className="text-xs text-muted">{formatDateTime(b.createdAt)}{b.createdBy ? ` · ${b.createdBy.name}` : ""}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone="success">{r.created ?? 0} created</Badge>
                        <Badge tone="neutral">{r.merged ?? 0} merged</Badge>
                        {r.flagged ? <Badge tone="warning">{r.flagged} to review</Badge> : null}
                        {r.skipped ? <Badge tone="outline">{r.skipped} skipped</Badge> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">No imports yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
