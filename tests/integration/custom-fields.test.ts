import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, withUser } from "@/lib/db";
import { createTicket, getTicket } from "@/lib/tickets/service";
import { deleteFieldDef, fieldsForForm, listFieldDefs, saveFieldDef, updateTicketFields } from "@/lib/fields/service";

const U = DEMO.users;
const C = DEMO.customers.contoso;
const F = DEMO.customers.fabrikam;

const hw = { title: "Laptop won't charge", description: "The charger light is off.", priority: "normal", category: "hardware" };
let costCenter: string;
let location: string;
let warrantyNote: string;
let fabrikamOnly: string;

beforeAll(async () => {
  await freshDatabase();
  const op = await principal(U.operator);
  costCenter = (await saveFieldDef(op, null, { label: "Cost center", kind: "text", required: true, customerId: C })).id;
  location = (await saveFieldDef(op, null, { label: "Office", kind: "select", options: ["Seattle", "Portland"], category: "hardware" })).id;
  warrantyNote = (await saveFieldDef(op, null, { label: "Warranty claim", kind: "long_text", staffOnly: true })).id;
  fabrikamOnly = (await saveFieldDef(op, null, { label: "Plant", kind: "text", customerId: F })).id;
});

describe("custom fields", () => {
  it("the form shows each person the fields for their clients, never technician-only ones to clients", async () => {
    const riley = (await fieldsForForm(await principal(U.contosoRequester))).map((f) => f.id);
    expect(riley).toEqual(expect.arrayContaining([costCenter, location]));
    expect(riley).not.toContain(warrantyNote);
    expect(riley).not.toContain(fabrikamOnly);
    expect((await fieldsForForm(await principal(U.tech))).map((f) => f.id)).toContain(warrantyNote);
  });

  it("required answers are enforced and checked, then shown on the ticket", async () => {
    const riley = await principal(U.contosoRequester);
    await expectAppError(createTicket(riley, hw, randomUUID()), 422);
    await expectAppError(createTicket(riley, { ...hw, fields: { [costCenter]: "CC-100", [location]: "Tokyo" } }, randomUUID()), 422);
    const t = await createTicket(riley, { ...hw, fields: { [costCenter]: " CC-100 ", [location]: "Portland", [warrantyNote]: "sneaky" } }, randomUUID());

    const mine = await getTicket(riley, t.id);
    expect(mine.fields.map((f) => [f.label, f.value])).toEqual([
      ["Cost center", "CC-100"],
      ["Office", "Portland"],
    ]);
    const tech = await principal(U.tech);
    const seen = await getTicket(tech, t.id);
    // A requester can't answer a technician-only field.
    expect(seen.fields.find((f) => f.id === warrantyNote)?.value).toBeNull();

    await updateTicketFields(tech, t.id, { [warrantyNote]: "Dell case 5512", [location]: "" });
    const after = await getTicket(tech, t.id);
    expect(after.fields.find((f) => f.id === warrantyNote)?.value).toBe("Dell case 5512");
    expect(after.fields.find((f) => f.id === location)?.value).toBeNull();
    // ...and the client never sees it, even straight from the table.
    const raw = await withUser(U.contosoRequester, (tx) => tx.query("select * from ticket_field_values where ticket_id = $1", [t.id]));
    expect(raw.rows).toHaveLength(1);
    expect((await getTicket(riley, t.id)).fields.map((f) => f.id)).not.toContain(warrantyNote);
    await expectAppError(updateTicketFields(riley, t.id, { [costCenter]: "CC-200" }), 403);
    const changed = await withUser(U.contosoRequester, (tx) => tx.query("update ticket_field_values set value = 'x' where ticket_id = $1 returning 1", [t.id]));
    expect(changed.rows).toHaveLength(0);
  });

  it("category decides which fields apply; answers that no longer apply stay visible", async () => {
    const riley = await principal(U.contosoRequester);
    const t = await createTicket(riley, { ...hw, category: "email", fields: { [costCenter]: "CC-7", [location]: "Seattle" } }, randomUUID());
    const tech = await principal(U.tech);
    // Office only applies to hardware: not saved for an email request.
    expect((await getTicket(tech, t.id)).fields.find((f) => f.id === location)).toBeUndefined();

    const h = await createTicket(riley, { ...hw, fields: { [costCenter]: "CC-8", [location]: "Seattle" } }, randomUUID());
    // Recategorized (by triage): the Office answer is kept and still shown.
    await asSystem((tx) => tx.query("update tickets set category = 'email' where id = $1", [h.id]));
    expect((await getTicket(tech, h.id)).fields.find((f) => f.id === location)).toMatchObject({ value: "Seattle", applies: false });
  });

  it("emailed requests skip required fields; only operators define fields", async () => {
    const t = await createTicket(await principal(U.contosoRequester), { ...hw, category: "general" }, randomUUID(), { source: "email" });
    expect(t.id).toBeTruthy();
    await expectAppError(saveFieldDef(await principal(U.manager), null, { label: "X", kind: "text" }), 403);
    await expectAppError(saveFieldDef(await principal(U.operator), null, { label: "Pick", kind: "select", options: ["One"] }), 422);
    const op = await principal(U.operator);
    expect((await listFieldDefs(op)).find((f) => f.id === costCenter)?.answers).toBeGreaterThan(0);
    await deleteFieldDef(op, fabrikamOnly);
    expect((await listFieldDefs(op)).map((f) => f.id)).not.toContain(fabrikamOnly);
  });
});
