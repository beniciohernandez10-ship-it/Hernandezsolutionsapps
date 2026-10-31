-- Website inquiries into the CRM, opt-outs and bounces, reply detection, and daily alerts.

ALTER TYPE "ActivityType" ADD VALUE 'WEBSITE_INQUIRY';
ALTER TYPE "ActivityType" ADD VALUE 'UNSUBSCRIBED';
ALTER TYPE "ActivityType" ADD VALUE 'BOUNCED';

ALTER TABLE "User" ADD COLUMN "dailyDigest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Client" ADD COLUMN "renewalTaskFor" TIMESTAMP(3);

CREATE TABLE "InboundLead" (
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "companyId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundLead_pkey" PRIMARY KEY ("leadId")
);
CREATE INDEX "InboundLead_receivedAt_idx" ON "InboundLead"("receivedAt");

CREATE TABLE "EmailSuppression" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email")
);

CREATE TABLE "InboxMessage" (
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "companyId" TEXT,
    "emailId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("messageId")
);
CREATE INDEX "InboxMessage_createdAt_idx" ON "InboxMessage"("createdAt");
