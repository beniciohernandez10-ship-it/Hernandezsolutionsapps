import { api, readJson } from "@/lib/http/api";
import { listAssets, registerAsset } from "@/lib/assets/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, principal }) => ({
  assets: await listAssets(principal, { includeRetired: req.nextUrl.searchParams.get("retired") === "1" }),
}));

export const POST = api(async ({ req, principal }) => registerAsset(principal, await readJson(req)), { rate: [60, 3600] });
