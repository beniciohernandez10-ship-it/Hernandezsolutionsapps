import { describe, expect, it } from "vitest";
import { bounceInfo, classifyMail, isAutoReply, isOptOutReply, replyText, type InboundMail } from "@/lib/inbox/classify";
import { fromGraph, parseRaw } from "@/lib/inbox/fetch";

const mail = (over: Partial<InboundMail> = {}): InboundMail => ({
  messageId: "<1@x>", from: "dana@acme.example", subject: "Re: Hi", text: "Sounds good", inReplyTo: null, references: [], headers: {}, receivedAt: new Date(), ...over,
});

describe("reply text", () => {
  it("keeps only what they wrote", () => {
    expect(replyText("Sounds good.\n\nOn Tue, Oct 27, 2026 at 9:00 AM Benny <b@x> wrote:\n> Hello")).toBe("Sounds good.");
    expect(replyText("Sounds good.\n> quoted")).toBe("Sounds good.");
    expect(replyText("Sounds good.\r\n\r\n-----Original Message-----\r\nFrom: Benny")).toBe("Sounds good.");
    expect(replyText("Sounds good.\n\nFrom: Benny <b@x>\nSent: Monday")).toBe("Sounds good.");
    expect(replyText("Sounds good.\n\nSent from my iPhone")).toBe("Sounds good.");
    expect(replyText("Two lines\nof reply")).toBe("Two lines\nof reply");
  });
});

describe("opt-out replies", () => {
  it.each(["No thanks", "no thank you.", "No, thank you", "Unsubscribe", "unsubscribe me please", "Remove me", "Please remove me from your list", "Stop", "STOP!", "Stop emailing me", "Do not email me", "Don't contact me", "Not interested", "Take me off your list"])(
    "honors %s",
    (t) => expect(isOptOutReply(t)).toBe(true),
  );

  it.each(["Yes, let's talk", "Stop by Tuesday and we can chat", "No problem, call me Friday", "No thanks needed, happy to help!", "Can you remove me from the other thread and call me instead? We have budget for this next quarter and want to talk.", "", "Thanks!"])(
    "doesn't read %j as one",
    (t) => expect(isOptOutReply(t)).toBe(false),
  );

  it("reads what they wrote, not the quoted email that contains the words", () => {
    expect(isOptOutReply('Yes please!\n\nOn Mon, Benny wrote:\n> reply "no thanks" and I won\'t email again.')).toBe(false);
    expect(isOptOutReply("\n\n  No thanks  \n\n> hello")).toBe(true);
  });
});

describe("automatic replies", () => {
  it("are recognized by header or subject, and a person's reply isn't", () => {
    expect(isAutoReply(mail({ headers: { "auto-submitted": "auto-replied" } }))).toBe(true);
    expect(isAutoReply(mail({ headers: { "auto-submitted": "no" } }))).toBe(false);
    expect(isAutoReply(mail({ headers: { "x-autoreply": "yes" } }))).toBe(true);
    expect(isAutoReply(mail({ headers: { precedence: "auto_reply" } }))).toBe(true);
    expect(isAutoReply(mail({ subject: "Automatic reply: Hi" }))).toBe(true);
    expect(isAutoReply(mail({ subject: "Out of Office: Hi" }))).toBe(true);
    expect(isAutoReply(mail({ subject: "Re: Automatic reply settings in Outlook" }))).toBe(false);
  });
});

describe("bounces", () => {
  it.each([
    ["5.1.1", "", true],
    ["5.1.10", "", true],
    ["5.7.1", "user unknown", false],
    ["4.2.2", "", false],
    ["5.0.0", "address not found", true],
    ["5.0.0", "try later", false],
  ])("status %s %s: hard=%s", (status, extra, hard) => {
    expect(bounceInfo({ text: `Final-Recipient: rfc822; a@b.example\nStatus: ${status}\n${extra}`, headers: {} })).toMatchObject({ recipient: "a@b.example", hard, status });
  });

  it("uses wording when there's no status, and is soft when unclear", () => {
    expect(bounceInfo({ text: "The address not found by the server", headers: { "x-failed-recipients": "A@B.example" } })).toEqual({ recipient: "a@b.example", hard: true, status: null });
    expect(bounceInfo({ text: "It didn't work", headers: {} })).toEqual({ recipient: null, hard: false, status: null });
  });

  it("are told apart from people", () => {
    expect(classifyMail(mail({ from: "mailer-daemon@googlemail.com" }))).toBe("bounce");
    expect(classifyMail(mail({ from: "postmaster@acme.example" }))).toBe("bounce");
    expect(classifyMail(mail({ headers: { "content-type": "multipart/report; report-type=delivery-status" } }))).toBe("bounce");
    expect(classifyMail(mail({ text: "No thanks" }))).toBe("opt_out");
    expect(classifyMail(mail({ subject: "Automatic reply: x", text: "No thanks" }))).toBe("auto_reply");
    expect(classifyMail(mail())).toBe("reply");
  });
});

describe("reading raw email", () => {
  it("gets the sender, thread and text, and copes with missing parts", async () => {
    const m = await parseRaw(
      ["From: Dana Diaz <Dana@Acme.example>", "To: sales@example.test", "Subject: Re: Hi", "Message-ID: <abc@acme.example>", "In-Reply-To: <sent-1@example.test>", "References: <a@x> <sent-1@example.test>", "Auto-Submitted: no", "Date: Mon, 26 Oct 2026 10:00:00 -0700", "", "Sounds good"].join("\r\n"),
    );
    expect(m).toMatchObject({ from: "dana@acme.example", messageId: "<abc@acme.example>", inReplyTo: "<sent-1@example.test>", references: ["<a@x>", "<sent-1@example.test>"], subject: "Re: Hi" });
    expect(m!.text.trim()).toBe("Sounds good");
    expect(m!.headers["auto-submitted"]).toBe("no");
    expect(await parseRaw("Subject: no sender\r\n\r\nhello")).toBeNull();
    const noId = await parseRaw("From: a@b.example\r\nSubject: x\r\n\r\nhello");
    expect(noId!.messageId).toMatch(/^no-id:/);
  });

  it("reads Microsoft 365 messages", () => {
    const m = fromGraph({
      internetMessageId: "<g@x>", subject: "Re: Hi", receivedDateTime: "2026-10-26T17:00:00Z", from: { emailAddress: { address: "Dana@Acme.example" } }, body: { content: "Sounds good" },
      internetMessageHeaders: [{ name: "In-Reply-To", value: "<s@x>" }, { name: "References", value: "<a@x> <s@x>" }, { name: "Auto-Submitted", value: "auto-replied" }],
    });
    expect(m).toMatchObject({ from: "dana@acme.example", inReplyTo: "<s@x>", references: ["<a@x>", "<s@x>"], text: "Sounds good" });
    expect(isAutoReply(m!)).toBe(true);
    expect(fromGraph({ subject: "no sender" })).toBeNull();
  });
});
