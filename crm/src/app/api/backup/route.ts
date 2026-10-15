import { audit } from "@/lib/audit";
import { routeUser } from "@/lib/auth/session";
import { createBackup } from "@/lib/backup";
import { dayKey } from "@/lib/dates";

export const maxDuration = 120;

/** Owner-only JSON backup download. */
export async function GET() {
  const user = await routeUser("OWNER");
  if (user instanceof Response) return user;
  const backup = await createBackup();
  await audit(user.id, "backup.download");
  return new Response(JSON.stringify(backup), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="lead-command-center-backup-${dayKey()}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
