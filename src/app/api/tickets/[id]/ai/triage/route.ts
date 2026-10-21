import { api } from "@/lib/http/api";
import { triageTicket } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Technicians: a summary with suggested category, priority and next steps. */
export const POST = api(async ({ principal, params }) => triageTicket(principal, params.id), { rate: [10, 60] });
