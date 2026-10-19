import { routeUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Download an attachment. Always sent as a download, never rendered inline. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await routeUser("VIEWER");
  if (user instanceof Response) return user;
  const { id } = await params;
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
