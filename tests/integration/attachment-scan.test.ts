import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem } from "@/lib/db";
import { setConfigForTesting } from "@/lib/config";
import { processJobs } from "@/lib/jobs";
import { createTicket, getTicket } from "@/lib/tickets/service";
import { listNotifications } from "@/lib/notify/service";
import { openAttachment, rescanAttachment, uploadAttachment } from "@/lib/attachments/service";
import { MemoryStorage, setStorageForTesting } from "@/lib/attachments/storage";
import { setScanFetchForTesting } from "@/lib/attachments/scan";

const U = DEMO.users;
const text = (s: string) => new TextEncoder().encode(s);
// Built at runtime so this test file itself never matches the signature.
const EICAR = text(["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join(""));

const storage = new MemoryStorage();

/** Fake Cloudmersive: answers with whatever `reply` says and records each call. */
const calls: { apiKey: string | null; filename: string | null; size: number }[] = [];
let reply: () => Response = () => Response.json({ CleanResult: true, FoundViruses: null });
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  expect(String(input)).toBe("https://api.cloudmersive.com/virus/scan/file");
  const file = (init?.body as FormData).get("inputFile") as File;
  calls.push({ apiKey: new Headers(init?.headers).get("apikey"), filename: file.name, size: file.size });
  return reply();
}) as typeof fetch;

const withAntivirus = (on: boolean) =>
  setConfigForTesting({ appOrigin: "http://localhost:3000", demoMode: true, scanning: { cloudmersiveApiKey: on ? "cm_test" : undefined } });

async function newTicket() {
  return createTicket(await principal(U.contosoRequester), { title: "Screen issue", description: "See file", priority: "normal", category: "hardware" }, randomUUID());
}
const upload = async (ticketId: string, filename: string, data: Uint8Array, as: string = U.contosoRequester) =>
  uploadAttachment(await principal(as), { ticketId, filename, data, visibility: "public" });
const status = async (ticketId: string, id: string) => (await getTicket(await principal(U.tech), ticketId)).attachments.find((a) => a.id === id)!;
/** Lets backed-off scan jobs run now, as if their retry time had come. */
const due = () => asSystem((tx) => tx.query("update jobs set run_after = now() where kind = 'attachment.scan' and status = 'failed'"));

beforeAll(async () => {
  await freshDatabase();
  setStorageForTesting(storage);
  setScanFetchForTesting(fakeFetch);
});

beforeEach(() => {
  calls.length = 0;
  reply = () => Response.json({ CleanResult: true, FoundViruses: null });
  withAntivirus(false);
});

describe("scanning before anyone can open a file", () => {
  it("holds a new file and its notification until the scan marks it clean", async () => {
    const t = await newTicket();
    await processJobs({ limit: 50 });
    const a = await upload(t.id, "log.txt", text("Event 1000: application error"));
    expect(a.scanStatus).toBe("pending");
    const tech = await principal(U.tech);
    await expectAppError(openAttachment(tech, a.id), 404);
    expect((await listNotifications(tech)).some((n) => n.ticketId === t.id && n.kind === "attachment_added")).toBe(false);

    await processJobs({ limit: 50 });
    expect(await status(t.id, a.id)).toMatchObject({ scanStatus: "clean", scanDetail: null });
    expect((await openAttachment(tech, a.id)).info.id).toBe(a.id);
    expect((await listNotifications(tech)).some((n) => n.ticketId === t.id && n.kind === "attachment_added")).toBe(true);
    const row = await asSystem((tx) => tx.query<{ scan_engine: string }>("select scan_engine from ticket_attachments where id = $1", [a.id]));
    expect(row.rows[0].scan_engine).toBe("built-in");
  });

  it("quarantines malware: bytes deleted, never served, audited, nobody notified", async () => {
    const t = await newTicket();
    await processJobs({ limit: 50 });
    const a = await upload(t.id, "eicar.txt", EICAR);
    const key = (await asSystem((tx) => tx.query<{ storage_key: string }>("select storage_key from ticket_attachments where id = $1", [a.id]))).rows[0].storage_key;
    expect(storage.files.has(key)).toBe(true);
    await processJobs({ limit: 50 });

    expect(storage.files.has(key)).toBe(false);
    expect(await status(t.id, a.id)).toMatchObject({ scanStatus: "quarantined", scanDetail: "EICAR-Test-File" });
    // The requester sees that it was blocked, not the detail.
    const own = (await getTicket(await principal(U.contosoRequester), t.id)).attachments.find((x) => x.id === a.id)!;
    expect(own).toMatchObject({ scanStatus: "quarantined", scanDetail: null });
    await expectAppError(openAttachment(await principal(U.tech), a.id), 404);
    await expectAppError(openAttachment(await principal(U.contosoRequester), a.id), 404);
    expect((await listNotifications(await principal(U.tech))).some((n) => n.ticketId === t.id && n.kind === "attachment_added")).toBe(false);
    const audit = await asSystem((tx) => tx.query("select 1 from audit_events where action = 'attachment.quarantined' and target_id = $1", [a.id]));
    expect(audit.rows).toHaveLength(1);

    // The same bytes again are quarantined from the earlier verdict.
    const again = await upload(t.id, "renamed.txt", EICAR);
    await processJobs({ limit: 50 });
    expect((await status(t.id, again.id)).scanStatus).toBe("quarantined");
  });
});

describe("with the Cloudmersive antivirus configured", () => {
  it("sends the file with the API key and follows the verdict", async () => {
    withAntivirus(true);
    const t = await newTicket();
    const clean = await upload(t.id, "fine.txt", text(`clean ${randomUUID()}`));
    await processJobs({ limit: 50 });
    expect(calls).toEqual([{ apiKey: "cm_test", filename: "fine.txt", size: expect.any(Number) }]);
    expect((await status(t.id, clean.id)).scanStatus).toBe("clean");

    reply = () => Response.json({ CleanResult: false, FoundViruses: [{ FileName: "bad.txt", VirusName: "Win32.Test.Trojan" }] });
    const bad = await upload(t.id, "bad.txt", text(`bad ${randomUUID()}`));
    await processJobs({ limit: 50 });
    expect(await status(t.id, bad.id)).toMatchObject({ scanStatus: "quarantined", scanDetail: "Win32.Test.Trojan" });

    // EICAR is caught locally without sending it anywhere.
    calls.length = 0;
    const eicar = await upload(t.id, "test.txt", EICAR);
    await processJobs({ limit: 50 });
    expect(calls).toHaveLength(0);
    expect((await status(t.id, eicar.id)).scanStatus).toBe("quarantined");
  });

  it("reuses a recent clean verdict for identical bytes instead of sending them again", async () => {
    withAntivirus(true);
    const t = await newTicket();
    const bytes = text(`same ${randomUUID()}`);
    await upload(t.id, "one.txt", bytes);
    await processJobs({ limit: 50 });
    const second = await upload(t.id, "two.txt", bytes);
    await processJobs({ limit: 50 });
    expect(calls).toHaveLength(1);
    expect((await status(t.id, second.id)).scanStatus).toBe("clean");
  });

  it("a rejected key fails closed at once; staff can check again once it's fixed", async () => {
    withAntivirus(true);
    reply = () => new Response("{}", { status: 401 });
    const t = await newTicket();
    const a = await upload(t.id, "doc.txt", text(`doc ${randomUUID()}`));
    await processJobs({ limit: 50 });
    expect(await status(t.id, a.id)).toMatchObject({ scanStatus: "scan_failed", scanDetail: "The antivirus service rejected the API key." });
    await expectAppError(openAttachment(await principal(U.tech), a.id), 404);

    await expectAppError(rescanAttachment(await principal(U.contosoRequester), a.id), 404);
    reply = () => Response.json({ CleanResult: true, FoundViruses: null });
    expect(await rescanAttachment(await principal(U.tech), a.id)).toEqual({ scanStatus: "pending" });
    await processJobs({ limit: 50 });
    expect((await status(t.id, a.id)).scanStatus).toBe("clean");
    await expectAppError(rescanAttachment(await principal(U.tech), a.id), 409);
  });

  it("an outage retries with backoff, then fails closed when retries run out", async () => {
    withAntivirus(true);
    reply = () => new Response("{}", { status: 502 });
    const t = await newTicket();
    const a = await upload(t.id, "later.txt", text(`later ${randomUUID()}`));
    await processJobs({ limit: 50 });
    expect((await status(t.id, a.id)).scanStatus).toBe("pending");
    for (let i = 0; i < 5; i++) {
      await due();
      await processJobs({ limit: 50 });
    }
    expect((await status(t.id, a.id)).scanStatus).toBe("scan_failed");
    // The provider was asked once per attempt (502 on a POST is not retried within one attempt).
    expect(calls.filter((c) => c.filename === "later.txt")).toHaveLength(5);
  });
});

describe("active content is refused at upload", () => {
  const pdf = (body: string) => text(`%PDF-1.7\n${body}\n%%EOF`);

  it("PDFs with scripts, launch actions or embedded files, including #-escaped names", async () => {
    const t = await newTicket();
    for (const body of [
      "1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj",
      "1 0 obj << /S /Launch /F (cmd.exe) >> endobj",
      "1 0 obj << /Names << /EmbeddedFiles 2 0 R >> >> endobj",
      "1 0 obj << /S /J#61vaScript >> endobj",
    ]) {
      await expectAppError(upload(t.id, "form.pdf", pdf(body)), 422);
    }
  });

  it("but not ordinary PDFs, or bytes inside streams that happen to spell a name", async () => {
    const t = await newTicket();
    await upload(t.id, "plain.pdf", pdf("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj"));
    await upload(t.id, "image.pdf", pdf("3 0 obj << /Length 9 >> stream\n/JS (x) /Launch\nendstream endobj"));
  });

  it("Office files with OLE objects or ActiveX, but not embedded chart workbooks", async () => {
    const t = await newTicket();
    const zip = (parts: string) => text(`PK\u0003\u0004[Content_Types].xml word/document.xml ${parts}`);
    await expectAppError(upload(t.id, "a.docx", zip("word/embeddings/oleObject1.bin")), 422);
    await expectAppError(upload(t.id, "b.docx", zip("word/activeX/activeX1.xml")), 422);
    await upload(t.id, "c.docx", zip("word/embeddings/Microsoft_Excel_Worksheet.xlsx"));
  });
});
