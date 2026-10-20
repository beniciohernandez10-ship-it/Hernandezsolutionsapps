import { api } from "@/lib/http/api";
import { discardInbound } from "@/lib/email/inbound";

export const dynamic = "force-dynamic";

export const POST = api(async ({ principal, params }) => discardInbound(principal, params.id), { rate: [60, 60] });
