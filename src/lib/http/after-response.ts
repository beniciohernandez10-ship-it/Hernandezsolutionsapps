import { after } from "next/server";
import { drainSoon } from "../jobs";

/**
 * Processes queued jobs (notifications, intake) right after the response is
 * sent. Outside a request (scripts, tests) there is nothing to attach to, and
 * the cron run picks the jobs up instead.
 */
export function drainAfterResponse(opts: { sweep?: boolean } = {}) {
  try {
    after(() => drainSoon(opts));
  } catch {
    // Not inside a request scope.
  }
}
