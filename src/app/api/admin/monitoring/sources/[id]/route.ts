import { api } from "@/lib/http/api";
import { deleteAlertSource, rotateAlertSource } from "@/lib/monitoring/service";

export const dynamic = "force-dynamic";

/** New token (the old one stops working). */
export const POST = api(async ({ principal, params }) => rotateAlertSource(principal, params.id), { recentAuth: true });
export const DELETE = api(async ({ principal, params }) => deleteAlertSource(principal, params.id), { recentAuth: true });
