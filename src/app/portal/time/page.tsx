import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/current";
import { capabilities } from "@/lib/authz";
import { timesheet } from "@/lib/billing/service";
import { formatMinutes } from "@/lib/billing/compute";
import { PageTransition } from "@/components/page-transition";
import { AddTime, PersonPicker, RemoveEntry } from "./forms";

export const metadata = { title: "Timesheet" };

type SP = Record<string, string | undefined>;

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { principal } = await requirePrincipal("/portal/time");
  if (!capabilities(principal).staff) {
    return (
      <PageTransition>
        <h1>Timesheet</h1>
        <p className="muted">Timesheets are for technicians.</p>
      </PageTransition>
    );
  }
  const w = await timesheet(principal, { week: sp.week, userId: sp.user });
  const mine = w.userId === principal.userId;
  const person = mine ? "You" : (w.people.find((x) => x.id === w.userId)?.name ?? "Technician");
  const link = (week: string) => `/portal/time?week=${week}${mine ? "" : `&user=${w.userId}`}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.weekStart, i));

  return (
    <PageTransition>
      <div className="page-head">
        <div>
          <p className="eyebrow">Service desk</p>
          <h1>Timesheet</h1>
        </div>
        {w.people.length > 0 && <PersonPicker people={w.people} current={w.userId} self={principal.userId} week={w.weekStart} />}
      </div>
      <div className="spread">
        <div className="row">
          <Link className="btn" href={link(addDays(w.weekStart, -7))} scroll={false}>← Previous week</Link>
          <Link className="btn" href={link(addDays(w.weekStart, 7))} scroll={false}>Next week →</Link>
          <Link className="btn btn-ghost" href={mine ? "/portal/time" : `/portal/time?user=${w.userId}`} scroll={false}>This week</Link>
        </div>
        <p className="subtle">
          {person} · week of {dayLabel(w.weekStart)} · <strong>{formatMinutes(w.totalMinutes)}</strong> logged
          {w.billableMinutes !== w.totalMinutes && `, ${formatMinutes(w.billableMinutes)} billable`}
        </p>
      </div>

      {mine && <AddTime clients={w.clients} />}

      <div className="table-wrap">
        <table className="week-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Client</th>
              <th scope="col">Request</th>
              <th scope="col">Note</th>
              <th scope="col">Time</th>
              <th scope="col">Billable</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const list = w.entries.filter((e) => e.workDate === d);
              const total = list.reduce((n, e) => n + e.minutes, 0);
              if (list.length === 0) {
                return (
                  <tr key={d}>
                    <th scope="row">{dayLabel(d)}</th>
                    <td colSpan={5} className="subtle">No time logged</td>
                  </tr>
                );
              }
              return list.map((e, i) => (
                <tr key={e.id}>
                  {i === 0 && (
                    <th scope="row" rowSpan={list.length}>
                      {dayLabel(d)}
                      <br />
                      <span className="subtle">{formatMinutes(total)}</span>
                    </th>
                  )}
                  <td>{e.customerName}</td>
                  <td>{e.ticketId ? <Link href={`/portal/tickets/${e.ticketId}`}>#{e.ticketNumber}</Link> : <span className="subtle">General</span>}</td>
                  <td className="note-cell">{e.note ?? (e.ticketTitle ? <span className="subtle">{e.ticketTitle}</span> : "")}</td>
                  <td className="mono-text">{formatMinutes(e.minutes)}</td>
                  <td>
                    {e.billable ? "Yes" : "No"}
                    {e.billed ? " · invoiced" : ""}
                    {e.canEdit && <RemoveEntry id={e.id} label={`${formatMinutes(e.minutes)} on ${e.workDate}`} />}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <p className="subtle">To edit time on a request, open the request. To correct general work, remove it and log it again. Invoiced time is locked.</p>
    </PageTransition>
  );
}
