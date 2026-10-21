import { api } from "@/lib/http/api";
import { suggestArticles } from "@/lib/kb/service";

export const dynamic = "force-dynamic";

/** Articles that may answer what someone is typing into a new request. */
export const GET = api(async ({ req, principal }) => ({ items: await suggestArticles(principal, (req.nextUrl.searchParams.get("q") ?? "").slice(0, 300)) }), {
  rate: [120, 60],
});
