import { api, readJson } from "@/lib/http/api";
import { linkDevice } from "@/lib/tickets/service";
import { linkDeviceSchema } from "@/lib/tickets/schemas";

export const dynamic = "force-dynamic";

export const POST = api(async ({ req, principal, params }) => {
  const { deviceId } = linkDeviceSchema.parse(await readJson(req));
  return linkDevice(principal, params.id, deviceId);
});
