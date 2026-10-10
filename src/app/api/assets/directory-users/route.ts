import { api } from "@/lib/http/api";
import { searchPrimaryUsers } from "@/lib/assets/service";

export const dynamic = "force-dynamic";

// Each keystroke-debounced search is one Graph call per connected directory.
export const GET = api(
  async ({ req, principal }) =>
    searchPrimaryUsers(principal, {
      customerId: req.nextUrl.searchParams.get("customerId") ?? "",
      q: req.nextUrl.searchParams.get("q") ?? "",
    }),
  { rate: [120, 600] },
);
