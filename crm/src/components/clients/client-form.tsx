"use client";

import * as React from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/actions";

export interface ClientFormValues {
  contractStart: string;
  renewalDate: string;
  managedUsers: number | null;
  monthlyValue: number | null;
  implementationFee: number | null;
  primaryContactId: string | null;
  tenantDomain: string | null;
  tenantId: string | null;
  serviceScope: string | null;
  technicianId: string | null;
}

export function ClientForm({
  action, values, contacts, users, pricePerUser, submitLabel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  values: ClientFormValues;
  contacts: { id: string; name: string }[];
  users: { id: string; name: string }[];
  pricePerUser: number;
  submitLabel: string;
}) {
  const [users_, setUsers] = React.useState(values.managedUsers ? String(values.managedUsers) : "");
  const [monthly, setMonthly] = React.useState(values.monthlyValue !== null ? String(values.monthlyValue) : "");
  const [custom, setCustom] = React.useState(values.monthlyValue !== null && values.managedUsers !== null && values.monthlyValue !== values.managedUsers * pricePerUser);
  React.useEffect(() => {
    if (!custom && users_) setMonthly(String(Math.round(Number(users_) * pricePerUser * 100) / 100));
  }, [users_, custom, pricePerUser]);
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Contract start"><Input type="date" name="contractStart" defaultValue={values.contractStart} required /></Field>
      <Field label="Renewal date" hint="Optional"><Input type="date" name="renewalDate" defaultValue={values.renewalDate} /></Field>
      <Field label="Managed users"><Input type="number" name="managedUsers" min={1} value={users_} onChange={(e) => setUsers(e.target.value)} required /></Field>
      <Field label="Monthly recurring value ($)" hint={custom ? "Custom pricing" : `${users_ || 0} users × $${pricePerUser}`}>
        <Input type="number" name="monthlyValue" min={0} step="0.01" value={monthly} onChange={(e) => { setMonthly(e.target.value); setCustom(true); }} required />
      </Field>
      <Field label="Implementation fee ($)" hint="One-time; optional"><Input type="number" name="implementationFee" min={0} step="0.01" defaultValue={values.implementationFee ?? ""} /></Field>
      <Field label="Primary contact">
        <Select name="primaryContactId" defaultValue={values.primaryContactId ?? ""}>
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Microsoft 365 tenant domain" hint="Optional, e.g. contoso.onmicrosoft.com"><Input name="tenantDomain" defaultValue={values.tenantDomain ?? ""} /></Field>
      <Field label="Tenant ID" hint="Optional; a GUID, not a secret"><Input name="tenantId" defaultValue={values.tenantId ?? ""} /></Field>
      <Field label="Assigned technician">
        <Select name="technicianId" defaultValue={values.technicianId ?? ""}>
          <option value="">—</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </Field>
      <Field label="Service scope" className="sm:col-span-2"><Textarea name="serviceScope" rows={4} defaultValue={values.serviceScope ?? ""} placeholder="Managed IT for all staff, Microsoft 365 administration, Intune device management, help desk…" /></Field>
      <Alert tone="neutral" className="sm:col-span-2">Never store passwords, MFA codes, app secrets or other credentials here. Use your password manager.</Alert>
      <div className="flex justify-end sm:col-span-2"><SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
