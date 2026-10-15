import { Plus } from "lucide-react";
import Link from "next/link";
import { OutreachNav } from "@/components/outreach/subnav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { INDUSTRY_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { db } from "@/lib/db";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const user = await requireUser();
  const rows = await db.template.findMany({ orderBy: [{ channel: "asc" }, { name: "asc" }] });
  const groups = [
    { title: "First emails by industry", rows: rows.filter((t) => t.channel === "EMAIL" && t.industries.length) },
    { title: "Follow-ups and general emails", rows: rows.filter((t) => t.channel === "EMAIL" && !t.industries.length) },
    { title: "Call scripts", rows: rows.filter((t) => t.channel === "CALL_SCRIPT") },
  ];
  return (
    <div>
      <PageHeader
        title="Templates"
        description="Emails and call scripts. Edit any of them; your wording is kept when the app updates."
        actions={canWrite(user.role) ? <Button asChild variant="primary"><Link href="/outreach/templates/new"><Plus /> New template</Link></Button> : null}
      />
      <OutreachNav active="/outreach/templates" />
      {!rows.length ? <Alert tone="warning" className="mb-4">The built-in templates haven&apos;t been loaded yet. Run <code>npm run db:seed</code> once (the setup guide covers it).</Alert> : null}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <Card key={g.title}>
            <CardHeader title={`${g.title} (${g.rows.length})`} />
            <ul className="divide-y divide-border">
              {g.rows.map((t) => (
                <li key={t.id}>
                  <Link href={`/outreach/templates/${t.id}`} className="flex flex-col gap-1 px-4 py-2.5 text-sm hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{t.name}</span>
                      {t.subject ? <span className="block truncate text-muted">{t.subject}</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      {t.industries.slice(0, 4).map((i) => <Badge key={i} tone="outline">{INDUSTRY_LABEL[i] ?? i}</Badge>)}
                      {t.industries.length > 4 ? <Badge tone="outline">+{t.industries.length - 4}</Badge> : null}
                      {t.builtInKey ? <Badge tone="neutral">{t.edited ? "Built-in, edited" : "Built-in"}</Badge> : <Badge tone="accent">Yours</Badge>}
                      {!t.active ? <Badge tone="warning">Off</Badge> : null}
                      <span className="ml-2 text-xs text-subtle">Updated {formatDate(t.updatedAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
              {!g.rows.length ? <li className="px-4 py-3 text-sm text-muted">None yet.</li> : null}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
