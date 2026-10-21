import { z } from "zod";
import { withUser, type Queryable } from "../db";
import type { Principal } from "../authz";
import { AppError, notFound } from "../errors";

/**
 * Satisfaction surveys. When a request is resolved, its requester can rate it
 * good or bad with an optional comment, and change their answer until the
 * request closes. Row-level security enforces the same rules.
 */
export interface Survey {
  rating: "good" | "bad";
  comment: string | null;
  updatedAt: string;
}

export async function surveyFor(tx: Queryable, ticketId: string): Promise<Survey | null> {
  const r = await tx.query<{ rating: "good" | "bad"; comment: string | null; updated_at: string }>(
    "select rating, comment, updated_at from ticket_surveys where ticket_id = $1",
    [ticketId],
  );
  const s = r.rows[0];
  return s ? { rating: s.rating, comment: s.comment, updatedAt: new Date(s.updated_at).toISOString() } : null;
}

export const surveySchema = z.object({
  rating: z.enum(["good", "bad"]),
  comment: z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(2000))
    .optional(),
});

export async function submitSurvey(p: Principal, ticketId: string, raw: unknown) {
  const v = surveySchema.parse(raw);
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) throw notFound("Ticket");
  return withUser(p.userId, async (tx) => {
    const t = await tx.query<{ customer_id: string; requester_user_id: string; status: string }>(
      "select customer_id, requester_user_id, status from tickets where id = $1",
      [ticketId],
    );
    const ticket = t.rows[0];
    if (!ticket) throw notFound("Ticket");
    if (ticket.requester_user_id !== p.userId) throw new AppError(403, "forbidden", "Only the person who asked for help can rate it.");
    if (ticket.status !== "resolved") {
      throw new AppError(409, "invalid_transition", ticket.status === "closed" ? "This request is closed, so its rating can't change." : "You can rate a request once it's resolved.");
    }
    await tx.query(
      `insert into ticket_surveys (ticket_id, customer_id, requester_user_id, rating, comment) values ($1, $2, $3, $4, $5)
       on conflict (ticket_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now()`,
      [ticketId, ticket.customer_id, p.userId, v.rating, v.comment || null],
    );
    await tx.query(
      "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, 'ticket.survey', 'ticket', $3, $4)",
      [p.userId, ticket.customer_id, ticketId, JSON.stringify({ rating: v.rating })],
    );
    return { rating: v.rating };
  });
}
