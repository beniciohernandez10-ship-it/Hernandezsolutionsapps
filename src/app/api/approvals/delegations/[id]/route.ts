import { api } from "@/lib/http/api";
import { removeDelegation } from "@/lib/catalog/workflow";

export const dynamic = "force-dynamic";

export const DELETE = api(async ({ principal, params }) => removeDelegation(principal, params.id));
