import { api } from "@/lib/http/api";
import { getIncident } from "@/lib/incidents/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal, params }) => getIncident(principal, params.id));
