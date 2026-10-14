import { api } from "@/lib/http/api";
import { getTicket, listAssignableStaff, listQueues } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => {
  const t = await getTicket(principal, params.id);
  return { staff: await listAssignableStaff(principal, t.customerId), queues: await listQueues(principal) };
});
