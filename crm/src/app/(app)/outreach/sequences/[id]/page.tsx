import { notFound } from "next/navigation";
import { SequenceEditor } from "@/components/outreach/sequence-editor";
import { OutreachNav } from "@/components/outreach/subnav";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const metadata = { title: "Edit sequence" };

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("ADMIN");
  const { id } = await params;
  const s = id === "new" ? null : await db.sequence.findUnique({ where: { id }, include: { steps: { orderBy: { order: "asc" } } } });
  if (id !== "new" && !s) notFound();
  const templates = await db.template.findMany({ where: { channel: "EMAIL", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div>
      <PageHeader title={s ? s.name : "New sequence"} />
      <OutreachNav active="/outreach/sequences" />
      <SequenceEditor
        sequence={s ? { id: s.id, name: s.name, description: s.description, active: s.active, steps: s.steps.map((st) => ({ delayDays: st.delayDays, templateId: st.templateId, sameThread: st.sameThread })) } : null}
        templates={templates}
      />
    </div>
  );
}
