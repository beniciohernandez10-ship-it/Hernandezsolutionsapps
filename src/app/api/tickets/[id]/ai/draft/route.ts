import { api } from "@/lib/http/api";
import { draftReply } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Technicians: a reply draft to review and edit. Nothing is sent. */
export const POST = api(async ({ principal, params }) => draftReply(principal, params.id), { rate: [10, 60] });
