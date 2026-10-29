import { api } from "@/lib/http/api";
import { runRecurringNow } from "@/lib/recurring/service";

export const dynamic = "force-dynamic";

/** Opens a request now, outside the schedule. */
export const POST = api(async ({ principal, params }) => runRecurringNow(principal, params.id), { rate: [20, 60] });
