import { db } from "@/lib/db";

const TABLES = [
  "InboundLead", "EmailSuppression", "InboxMessage", "EmailMessage", "Enrollment", "SequenceStep", "Sequence", "Template", "Task", "Activity",
  "Contact", "Client", "Company", "AuditLog", "Setting", "Session", "User",
];

export async function resetDatabase() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

export async function makeUser(over: { email?: string; role?: "OWNER" | "ADMIN" | "SALES" | "VIEWER"; dailyDigest?: boolean } = {}) {
  return db.user.create({
    data: { email: over.email ?? "owner@example.test", name: "Olivia Owner", passwordHash: "x", role: over.role ?? "OWNER", dailyDigest: over.dailyDigest ?? true },
  });
}

export async function makeProspect(over: { name?: string; email?: string; mainEmail?: string; domain?: string; ownerId?: string; stage?: string } = {}) {
  const name = over.name ?? "Acme Dental";
  return db.company.create({
    data: {
      name,
      normalizedName: name.toLowerCase(),
      domain: over.domain ?? null,
      mainEmail: over.mainEmail ?? null,
      ownerId: over.ownerId ?? null,
      stage: (over.stage ?? "ATTEMPTED_CONTACT") as never,
      ...(over.email ? { contacts: { create: { name: "Dana Diaz", email: over.email, isPrimary: true } } } : {}),
    },
    include: { contacts: true },
  });
}

/** An email already sent to a prospect, optionally part of a running sequence with a draft waiting. */
export async function sentEmail(companyId: string, toEmail: string, opts: { messageId?: string; contactId?: string; withSequence?: boolean } = {}) {
  let enrollmentId: string | null = null;
  if (opts.withSequence) {
    const sequence = await db.sequence.create({ data: { name: `Seq ${companyId}` } });
    const enrollment = await db.enrollment.create({ data: { companyId, sequenceId: sequence.id, toEmail, contactId: opts.contactId ?? null, status: "ACTIVE", currentStep: 1 } });
    enrollmentId = enrollment.id;
  }
  const email = await db.emailMessage.create({
    data: { companyId, contactId: opts.contactId ?? null, toEmail, subject: "Quick question", body: "Hello", status: "SENT", sentAt: new Date(), sentVia: "gmail", providerMessageId: opts.messageId ?? null, enrollmentId },
  });
  const draft = enrollmentId
    ? await db.emailMessage.create({ data: { companyId, contactId: opts.contactId ?? null, toEmail, subject: "Re: Quick question", body: "Following up", status: "PENDING_APPROVAL", enrollmentId, stepOrder: 2 } })
    : null;
  return { email, draft, enrollmentId };
}
