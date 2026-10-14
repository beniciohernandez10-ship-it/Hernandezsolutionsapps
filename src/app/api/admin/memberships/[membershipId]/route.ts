import { api } from "@/lib/http/api";
import { revokeMembership } from "@/lib/admin/service";

export const dynamic = "force-dynamic";

export const DELETE = api(async ({ principal, params }) => revokeMembership(principal, params.membershipId), { recentAuth: true });
