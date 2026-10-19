"use client";

import { Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteTemplateAction, saveTemplateAction } from "@/app/(app)/outreach/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useServerAction } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { INDUSTRIES } from "@/lib/constants";
import { MERGE_FIELDS, renderTemplate, unresolvedPlaceholders } from "@/lib/templates";

export function TemplateEditor({
  template, sender, canEdit, canDelete,
}: {
  template: { id: string; name: string; channel: "EMAIL" | "CALL_SCRIPT"; industries: string[]; subject: string; body: string; active: boolean; builtIn: boolean } | null;
  sender: { senderName: string; senderCompany: string; website: string; senderPhone: string };
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(template?.name ?? "");
  const [channel, setChannel] = React.useState<"EMAIL" | "CALL_SCRIPT">(template?.channel ?? "EMAIL");
  const [industries, setIndustries] = React.useState<string[]>(template?.industries ?? []);
  const [subject, setSubject] = React.useState(template?.subject ?? "");
  const [body, setBody] = React.useState(template?.body ?? "");
  const [active, setActive] = React.useState(template?.active ?? true);
  const [withNote, setWithNote] = React.useState(true);
  const save = useServerAction(saveTemplateAction);
  const del = useServerAction(deleteTemplateAction);
  const sample = {
    firstName: "Jordan", contactName: "Jordan Lee", contactTitle: "Office Manager", companyName: "Example Dental Group", city: "Irvine", industry: "Private healthcare",
    personalNote: withNote ? "I saw you recently opened a second office in Tustin." : "",
    ...sender,
  };
  const preview = { subject: renderTemplate(subject, sample), body: renderTemplate(body, sample) };
  const unresolved = unresolvedPlaceholders(`${preview.subject}\n${preview.body}`);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Type">
              <Select value={channel} onChange={(e) => setChannel(e.target.value as "EMAIL" | "CALL_SCRIPT")} disabled={template?.builtIn}>
                <option value="EMAIL">Email</option>
                <option value="CALL_SCRIPT">Call script</option>
              </Select>
            </Field>
          </div>
          {channel === "EMAIL" ? (
            <Field label="First email for these industries" hint="Leave empty for follow-ups and general emails. Your own template wins over a built-in one for the same industry.">
              <MultiSelect label="Industries" options={INDUSTRIES} value={industries} onChange={setIndustries} searchable />
            </Field>
          ) : null}
          {channel === "EMAIL" ? <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field> : null}
          <Field label={channel === "EMAIL" ? "Message" : "Script"} hint="Don't add a signature; it's added when the email is sent.">
            <Textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} className="font-sans leading-6" />
          </Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Turned on</label>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={save.pending}
                onClick={async () => {
                  const r = await save.run(template?.id ?? null, { name, channel, industries: channel === "EMAIL" ? industries : [], subject: channel === "EMAIL" ? subject : "", body, active });
                  const id = (r?.data as { id?: string } | undefined)?.id;
                  if (r?.ok && !template && id) router.replace(`/outreach/templates/${id}`);
                  else if (r?.ok) router.refresh();
                }}
              >
                <Save /> Save template
              </Button>
              {template && canDelete ? (
                <Button
                  variant="danger-ghost"
                  disabled={del.pending}
                  onClick={async () => {
                    if (!window.confirm(template.builtIn ? "Turn off this built-in template?" : "Delete this template?")) return;
                    const r = await del.run(template.id);
                    if (r?.ok) router.push("/outreach/templates");
                  }}
                >
                  <Trash2 /> {template.builtIn ? "Turn off" : "Delete"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Preview"
            description="With sample details, so you can check how merge fields read."
            action={<label className="flex items-center gap-2 text-xs"><Checkbox checked={withNote} onChange={(e) => setWithNote(e.target.checked)} /> With opening line</label>}
          />
          <CardBody>
            {channel === "EMAIL" ? <p className="mb-2 text-sm font-medium">{preview.subject || "(no subject)"}</p> : null}
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{preview.body}</pre>
            {unresolved.length ? <p className="mt-3 text-sm text-warning">Unresolved: {unresolved.join(", ")}. Emails can&apos;t be sent until these are filled in.</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Merge fields" />
          <CardBody>
            <ul className="space-y-1 text-xs">
              {MERGE_FIELDS.map((f) => <li key={f.key}><code className="rounded bg-surface-2 px-1">{`{{${f.key}}}`}</code> <span className="text-muted">{f.label}</span></li>)}
              <li><code className="rounded bg-surface-2 px-1">[[note to self]]</code> <span className="text-muted">Must be replaced before sending</span></li>
            </ul>
            <p className="mt-3 text-xs text-muted">House rules: don&apos;t assume they use Microsoft, don&apos;t suggest their security is poor, and for startups offer to complement their engineers.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
