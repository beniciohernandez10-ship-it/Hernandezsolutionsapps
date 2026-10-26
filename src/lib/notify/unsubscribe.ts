import { z } from "zod";
import { asSystem, type Queryable } from "../db";
import { randomToken, sha256 } from "../auth/crypto";
import type { NotificationKind } from "../email/templates";

/**
 * One-click unsubscribe (RFC 8058). Every notification email links to a
 * random token that turns off the kind of email it is, or all email, for its
 * recipient without signing in. The token is the only credential, so it is
 * long, random, stored as a hash, expires, and can do nothing else.
 */

export const EMAIL_CATEGORIES = ["email_ticket_updates", "email_new_tickets", "email_assignments", "email_sla"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Same wording as the email settings page. */
export const CATEGORY_LABEL: Record<EmailCategory, string> = {
  email_ticket_updates: "Updates on my requests",
  email_new_tickets: "New requests",
  email_assignments: "Assignments",
  email_sla: "Service-level alerts",
};

const TOKEN_DAYS = 365;

/** The setting an email falls under when the job didn't say (jobs queued before categories were recorded). */
export function categoryForKind(kind: NotificationKind): EmailCategory {
  if (kind === "ticket_created") return "email_new_tickets";
  if (kind === "assigned") return "email_assignments";
  if (kind === "sla_warning" || kind === "sla_breached") return "email_sla";
  return "email_ticket_updates";
}

export async function issueUnsubscribeToken(tx: Queryable, userId: string, category: EmailCategory): Promise<string> {
  const token = randomToken(32);
  await tx.query(
    `insert into email_unsubscribe_tokens (token_hash, user_id, category, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))`,
    [sha256(token), userId, category, TOKEN_DAYS],
  );
  return token;
}

/** Shape check only; a token that passes still has to exist. */
const tokenShape = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export interface UnsubscribeInfo {
  category: EmailCategory;
  label: string;
  /** Masked address, so the reader can tell which account this is. */
  email: string;
  categoryOn: boolean;
  allOn: boolean;
}

function mask(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "your account";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

async function load(tx: Queryable, token: string) {
  if (!tokenShape.safeParse(token).success) return null;
  const r = await tx.query<{ user_id: string; category: EmailCategory; email: string; email_enabled: boolean | null; on: boolean | null }>(
    `select t.user_id, t.category, u.email, p.email_enabled,
            case t.category when 'email_ticket_updates' then p.email_ticket_updates when 'email_new_tickets' then p.email_new_tickets
                            when 'email_assignments' then p.email_assignments else p.email_sla end as on
       from email_unsubscribe_tokens t join users u on u.id = t.user_id
       left join notification_preferences p on p.user_id = t.user_id
      where t.token_hash = $1 and t.expires_at > now() and u.status = 'active'`,
    [sha256(token)],
  );
  return r.rows[0] ?? null;
}

export async function lookupUnsubscribe(token: string): Promise<UnsubscribeInfo | null> {
  return asSystem(async (tx) => {
    const row = await load(tx, token);
    if (!row) return null;
    return {
      category: row.category,
      label: CATEGORY_LABEL[row.category],
      email: mask(row.email),
      categoryOn: row.on !== false,
      allOn: row.email_enabled !== false,
    };
  });
}

export const UNSUBSCRIBE_ACTIONS = ["category", "all", "undo-category", "undo-all"] as const;
export type UnsubscribeAction = (typeof UNSUBSCRIBE_ACTIONS)[number];

/** Applies one action. Repeating it is harmless; returns null for an unknown or expired token. */
export async function applyUnsubscribe(token: string, action: UnsubscribeAction): Promise<UnsubscribeInfo | null> {
  return asSystem(async (tx) => {
    const row = await load(tx, token);
    if (!row) return null;
    // The column comes from a checked enum, never from the request.
    const column = action === "all" || action === "undo-all" ? "email_enabled" : row.category;
    const value = action.startsWith("undo-");
    await tx.query(
      `insert into notification_preferences (user_id, ${column}, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set ${column} = $2, updated_at = now()`,
      [row.user_id, value],
    );
    await tx.query("update email_unsubscribe_tokens set used_at = now() where token_hash = $1", [sha256(token)]);
    await tx.query(
      "insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, $2, 'user', $3, $4)",
      [row.user_id, value ? "notifications.resubscribe" : "notifications.unsubscribe", row.user_id, JSON.stringify({ setting: column, via: "email_link" })],
    );
    const after = await load(tx, token);
    return {
      category: row.category,
      label: CATEGORY_LABEL[row.category],
      email: mask(row.email),
      categoryOn: after?.on !== false,
      allOn: after?.email_enabled !== false,
    };
  });
}
