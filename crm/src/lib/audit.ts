import { headers } from "next/headers";
import { db } from "./db";

export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

/** Append-only audit trail. Never pass secrets in meta. */
export async function audit(
  userId: string | null,
  action: string,
  entity?: { type: string; id?: string | null },
  meta?: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId,
      action,
      entity: entity?.type,
      entityId: entity?.id ?? null,
      meta: (meta ?? undefined) as object | undefined,
      ip: await clientIp(),
    },
  });
}
