import { api } from "@/lib/http/api";
import { checkAuditNow } from "@/lib/audit/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Operators: send waiting audit events to the off-site store, then check its hash chain. */
export const POST = api(async ({ principal }) => checkAuditNow(principal), { recentAuth: true, rate: [6, 60] });
