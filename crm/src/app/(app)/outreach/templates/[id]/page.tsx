import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/outreach/template-editor";
import { OutreachNav } from "@/components/outreach/subnav";
import { PageHeader } from "@/components/ui/misc";
import { canAdmin, canWrite } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Edit template" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const t = id === "new" ? null : await db.template.findUnique({ where: { id } });
  if (id !== "new" && !t) notFound();
  const outreach = await getSetting("outreach");
  return (
    <div>
      <PageHeader title={t ? t.name : "New template"} />
      <OutreachNav active="/outreach/templates" />
      <TemplateEditor
        template={t ? { id: t.id, name: t.name, channel: t.channel, industries: t.industries, subject: t.subject, body: t.body, active: t.active, builtIn: !!t.builtInKey } : null}
        sender={{ senderName: outreach.senderName, senderCompany: outreach.companyName, website: outreach.website, senderPhone: outreach.senderPhone }}
        canEdit={canWrite(user.role)}
        canDelete={canAdmin(user.role)}
      />
    </div>
  );
}
