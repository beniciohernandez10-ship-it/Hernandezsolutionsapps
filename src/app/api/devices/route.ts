import { api } from "@/lib/http/api";
import { listDevices } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => listDevices(principal, req.nextUrl.searchParams.get("customerId") ?? undefined));
