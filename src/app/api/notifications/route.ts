import { api } from "@/lib/http/api";
import { listNotifications, unreadCount } from "@/lib/notify/service";

export const dynamic = "force-dynamic";

export const GET = api(async ({ principal }) => {
  const [items, unread] = await Promise.all([listNotifications(principal), unreadCount(principal)]);
  return { items, unread };
});
