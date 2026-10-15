"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { handleActionError, type ActionState } from "@/lib/actions";
import { requireActionUser } from "@/lib/auth/session";
import { db, Prisma } from "@/lib/db";

const layoutSchema = z.array(z.object({ id: z.string().max(40), visible: z.boolean(), wide: z.boolean().optional() })).max(40);

export async function saveDashboardLayoutAction(layout: z.input<typeof layoutSchema>): Promise<ActionState> {
  try {
    const user = await requireActionUser("VIEWER");
    const parsed = layoutSchema.parse(layout);
    await db.user.update({ where: { id: user.id }, data: { dashboardLayout: parsed } });
    revalidatePath("/");
    return { ok: true, message: "Dashboard saved." };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function resetDashboardLayoutAction(): Promise<ActionState> {
  try {
    const user = await requireActionUser("VIEWER");
    await db.user.update({ where: { id: user.id }, data: { dashboardLayout: Prisma.DbNull } });
    revalidatePath("/");
    return { ok: true, message: "Dashboard reset to the default layout." };
  } catch (err) {
    return handleActionError(err);
  }
}
