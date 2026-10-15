import { sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { TASK_TYPE_LABEL } from "@/lib/constants";

/**
 * Private calendar feed of a user's open follow-ups, for Outlook or Google Calendar.
 * The URL carries a random token; only its SHA-256 is stored, and rotating it in
 * Account settings revokes old subscriptions. Phone numbers and notes are left out.
 */
export const dynamic = "force-dynamic";

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");
}

function stamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = token.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(raw)) return new Response("Not found", { status: 404 });
  if (!(await rateLimit(`ics:${sha256(raw).slice(0, 16)}`, 120, 3600))) return new Response("Too many requests", { status: 429 });
  const user = await db.user.findUnique({ where: { calendarToken: sha256(raw) }, select: { id: true, active: true } });
  if (!user?.active) return new Response("Not found", { status: 404 });

  const since = new Date(Date.now() - 14 * 86400_000);
  const tasks = await db.task.findMany({
    where: { completedAt: null, dueAt: { gte: since }, OR: [{ assigneeId: user.id }, { assigneeId: null }], company: { archived: false } },
    include: { company: { select: { id: true, name: true } }, contact: { select: { name: true } } },
    orderBy: { dueAt: "asc" },
    take: 1000,
  });
  const origin = process.env.APP_ORIGIN ?? new URL(req.url).origin;
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hernandez Solutions//Lead Command Center//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lead Command Center follow-ups",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const t of tasks) {
    const minutes = t.durationMin ?? (t.type === "MEETING" ? 30 : 15);
    const end = new Date(t.dueAt.getTime() + minutes * 60000);
    const summary = `${TASK_TYPE_LABEL[t.type]}: ${t.company.name}${t.contact ? ` (${t.contact.name})` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${t.id}@lead-command-center`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(t.dueAt)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${esc(summary)}`),
      fold(`DESCRIPTION:${esc(`${t.title}\nOpen: ${origin}/leads/${t.company.id}`)}`),
      fold(`URL:${origin}/leads/${t.company.id}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
