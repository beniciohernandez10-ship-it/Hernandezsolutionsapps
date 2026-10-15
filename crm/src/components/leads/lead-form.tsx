"use client";

import Link from "next/link";
import * as React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions";
import {
  BUSINESS_STAGES, CONTACT_METHODS, DEFAULT_PRICE_PER_USER, INDUSTRIES, PIPELINE_STAGES, PRIORITIES, REGIONS, VERIFICATION,
} from "@/lib/constants";

export interface LeadFormValues {
  name?: string;
  industry?: string;
  subindustry?: string | null;
  businessStage?: string;
  website?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  region?: string | null;
  headquarters?: string | null;
  additionalLocations?: string[];
  employeeCount?: number | null;
  employeeCountSource?: string | null;
  description?: string | null;
  ownershipType?: string | null;
  fundingStage?: string | null;
  growthIndicators?: string | null;
  mainEmail?: string | null;
  mainEmailStatus?: string;
  mainPhone?: string | null;
  mainPhoneStatus?: string;
  contactFormUrl?: string | null;
  preferredContactMethod?: string;
  source?: string | null;
  sourceUrl?: string | null;
  personalNote?: string | null;
  priority?: string;
  stage?: string;
  ownerId?: string | null;
  notes?: string | null;
  tags?: string[];
  managedUsers?: number | null;
  pricePerUser?: number | null;
  monthlyValueOverride?: number | null;
  implementationFee?: number | null;
  closeProbability?: number | null;
  expectedCloseDate?: string | null;
  doNotContact?: boolean;
}

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function LeadForm({
  action,
  values = {},
  users,
  submitLabel,
  cancelHref,
  defaultPrice = DEFAULT_PRICE_PER_USER,
}: {
  action: Action;
  values?: LeadFormValues;
  users: { id: string; name: string }[];
  submitLabel: string;
  cancelHref: string;
  defaultPrice?: number;
}) {
  const v = values;
  const [users_, setUsers] = React.useState<number | "">(v.managedUsers ?? "");
  const [price, setPrice] = React.useState<number | "">(v.pricePerUser ?? "");
  const [override, setOverride] = React.useState<number | "">(v.monthlyValueOverride ?? "");
  const monthly = override !== "" ? Number(override) : (Number(users_) || 0) * (price !== "" ? Number(price) : defaultPrice);
  const [ignoreDupes, setIgnoreDupes] = React.useState(false);
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Company" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company name" className="sm:col-span-2 lg:col-span-1"><Input name="name" required defaultValue={v.name} /></Field>
          <Field label="Industry">
            <Select name="industry" defaultValue={v.industry ?? "other"}>
              {INDUSTRIES.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </Select>
          </Field>
          <Field label="Subindustry"><Input name="subindustry" defaultValue={v.subindustry ?? ""} /></Field>
          <Field label="Startup or established">
            <Select name="businessStage" defaultValue={v.businessStage ?? "UNKNOWN"}>
              {BUSINESS_STAGES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </Select>
          </Field>
          <Field label="Website"><Input name="website" defaultValue={v.website ?? ""} placeholder="example.com" /></Field>
          <Field label="Estimated employees"><Input name="employeeCount" type="number" min={0} defaultValue={v.employeeCount ?? ""} /></Field>
          <Field label="Where the employee count came from"><Input name="employeeCountSource" defaultValue={v.employeeCountSource ?? ""} placeholder="LinkedIn company page, Oct 2026" /></Field>
          <Field label="Ownership type"><Input name="ownershipType" defaultValue={v.ownershipType ?? ""} placeholder="Private, family-owned, PE-backed…" /></Field>
          <Field label="Funding stage (startups)"><Input name="fundingStage" defaultValue={v.fundingStage ?? ""} placeholder="Seed, Series A…" /></Field>
          <Field label="Growth indicators" className="sm:col-span-2 lg:col-span-3"><Input name="growthIndicators" defaultValue={v.growthIndicators ?? ""} placeholder="Hiring 5 roles, opened second office…" /></Field>
          <Field label="Company description" className="sm:col-span-2 lg:col-span-3"><Textarea name="description" defaultValue={v.description ?? ""} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Location" description="Region fills in automatically from the city when left blank." />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Street address" className="sm:col-span-2"><Input name="streetAddress" defaultValue={v.streetAddress ?? ""} /></Field>
          <Field label="City"><Input name="city" defaultValue={v.city ?? ""} /></Field>
          <Field label="State"><Input name="state" defaultValue={v.state ?? ""} placeholder="CA" /></Field>
          <Field label="ZIP code"><Input name="zip" defaultValue={v.zip ?? ""} inputMode="numeric" /></Field>
          <Field label="Region">
            <Select name="region" defaultValue={v.region ?? ""}>
              <option value="">Automatic</option>
              {REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Headquarters" className="sm:col-span-2"><Input name="headquarters" defaultValue={v.headquarters ?? ""} /></Field>
          <Field label="Additional locations" hint="One per line" className="sm:col-span-2 lg:col-span-4">
            <Textarea name="additionalLocations" rows={2} defaultValue={(v.additionalLocations ?? []).join("\n")} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Main business contact details" description="Only record what you've seen. Leave anything you haven't confirmed as Unverified." />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Main business email" className="sm:col-span-2"><Input name="mainEmail" type="email" defaultValue={v.mainEmail ?? ""} /></Field>
          <Field label="Email status">
            <Select name="mainEmailStatus" defaultValue={v.mainEmailStatus ?? "UNKNOWN"}>
              {VERIFICATION.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Preferred contact method">
            <Select name="preferredContactMethod" defaultValue={v.preferredContactMethod ?? "UNKNOWN"}>
              {CONTACT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Main business phone" className="sm:col-span-2"><Input name="mainPhone" type="tel" defaultValue={v.mainPhone ?? ""} /></Field>
          <Field label="Phone status">
            <Select name="mainPhoneStatus" defaultValue={v.mainPhoneStatus ?? "UNKNOWN"}>
              {VERIFICATION.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Contact form URL"><Input name="contactFormUrl" defaultValue={v.contactFormUrl ?? ""} /></Field>
          <Field label="Where this lead came from" className="sm:col-span-2"><Input name="source" defaultValue={v.source ?? ""} placeholder="Google Maps, referral, LinkedIn…" /></Field>
          <Field label="Source link" className="sm:col-span-2"><Input name="sourceUrl" defaultValue={v.sourceUrl ?? ""} /></Field>
          <Field label="Opening line" hint="A true, specific line about them. Used to personalize emails and call openers." className="sm:col-span-2 lg:col-span-4">
            <Input name="personalNote" defaultValue={v.personalNote ?? ""} placeholder="Saw you just opened a second office in Irvine." />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox name="doNotContact" defaultChecked={v.doNotContact} /> Do not contact (blocks emails and call queues)
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lead management" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Stage">
            <Select name="stage" defaultValue={v.stage ?? "NEW_LEAD"}>
              {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue={v.priority ?? "MEDIUM"}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Assigned salesperson">
            <Select name="ownerId" defaultValue={v.ownerId ?? ""}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Tags" hint="Comma separated"><Input name="tags" defaultValue={(v.tags ?? []).join(", ")} /></Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4"><Textarea name="notes" rows={4} defaultValue={v.notes ?? ""} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Opportunity estimate" description={`Monthly = managed users × price per user ($${defaultPrice} default). Estimates are never counted as revenue.`} />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Estimated managed users">
            <Input name="managedUsers" type="number" min={0} value={users_} onChange={(e) => setUsers(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
          <Field label="Price per user / month" hint={`Blank uses $${defaultPrice}`}>
            <Input name="pricePerUser" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} placeholder={String(defaultPrice)} />
          </Field>
          <Field label="Custom monthly value" hint="Overrides users × price">
            <Input name="monthlyValueOverride" type="number" min={0} step="0.01" value={override} onChange={(e) => setOverride(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
          <Field label="One-time implementation fee"><Input name="implementationFee" type="number" min={0} step="0.01" defaultValue={v.implementationFee ?? ""} /></Field>
          <Field label="Close probability (%)" hint="Blank uses the stage default"><Input name="closeProbability" type="number" min={0} max={100} defaultValue={v.closeProbability ?? ""} /></Field>
          <Field label="Expected close date"><Input name="expectedCloseDate" type="date" defaultValue={v.expectedCloseDate ?? ""} /></Field>
          <div className="flex flex-col justify-end gap-1 rounded-md bg-surface-2 px-3 py-2 text-sm sm:col-span-2">
            <span className="text-muted">Estimated monthly {fmt(monthly)} · annual {fmt(monthly * 12)}</span>
          </div>
        </CardBody>
      </Card>

      <input type="hidden" name="ignoreDuplicates" value={ignoreDupes ? "1" : ""} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <label className="mr-auto flex items-center gap-2 text-xs text-muted">
          <Checkbox checked={ignoreDupes} onChange={(e) => setIgnoreDupes(e.target.checked)} /> Save even if it looks like a duplicate
        </label>
        <Button asChild variant="ghost"><Link href={cancelHref}>Cancel</Link></Button>
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
