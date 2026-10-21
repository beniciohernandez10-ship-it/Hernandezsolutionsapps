import { api } from "@/lib/http/api";
import { draftWorkaroundArticle } from "@/lib/problems/service";

export const dynamic = "force-dynamic";

/** Drafts a knowledge article from the problem workaround (or returns the existing one). */
export const POST = api(async ({ principal, params }) => draftWorkaroundArticle(principal, params.id), { rate: [20, 60] });
