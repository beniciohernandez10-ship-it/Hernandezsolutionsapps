import { createHash } from "node:crypto";
import { withUser, type Queryable } from "../db";
import {
  canSeeOrgFor,
  customersWhere,
  isStaffFor,
  ORG_ROLES,
  requireMember,
  requireStaff,
  roleFor,
  STAFF_ROLES,
  type Principal,
} from "../authz";
import { AppError, forbidden, notFound } from "../errors";
import { config } from "../config";
import {
  addMessageSchema,
  createTicketSchema,
  listTicketsSchema,
  updateTicketSchema,
  type ListTicketsInput,
  type Status,
} from "./schemas";

export interface TicketSummary {
  id: string;
  number: number;
  customerId: string;
  customerName: string;
  title: string;
  priority: string;
  category: string;
  status: Status;
  requesterName: string;
  assigneeName: string | null;
  queueName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TicketMessage {
  id: string;
  authorName: string;
  authorIsStaff: boolean;
  visibility: "public" | "internal";
  body: string;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  requesterUserId: string;
  assigneeUserId: string | null;
  queueId: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  reopenCount: number;
  messages: TicketMessage[];
  events: { kind: string; fromValue: string | null; toValue: string | null; actorName: string | null; createdAt: string }[];
  devices: { id: string; name: string; operatingSystem: string | null; complianceState: string | null }[];
  viewer: {
    role: string;
    isStaff: boolean;
    canReply: boolean;
    canAddInternalNote: boolean;
    canChangeStatus: Status[];
    canAssign: boolean;
    canLinkDevices: boolean;
    reopenAllowed: boolean;
  };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

async function audit(
  tx: Queryable,
  p: Principal,
  action: string,
  customerId: string | null,
  targetType: string,
  targetId: string,
  details: Record<string, unknown> = {},
) {
  await tx.query(
    "insert into audit_events (actor_user_id, customer_id, action, target_type, target_id, details) values ($1, $2, $3, $4, $5, $6)",
    [p.userId, customerId, action, targetType, targetId, JSON.stringify(details)],
  );
}

/** Builds the explicit visibility predicate for the principal (in addition to RLS). */
function scopeClause(p: Principal, params: unknown[]) {
  const org = customersWhere(p, (r) => ORG_ROLES.includes(r));
  const own = customersWhere(p, (r) => r === "requester");
  params.push(org, own, p.userId);
  const n = params.length;
  return `(t.customer_id = any($${n - 2}::uuid[]) or (t.customer_id = any($${n - 1}::uuid[]) and t.requester_user_id = $${n}))`;
}

const SUMMARY_COLUMNS = `
  t.id, t.number, t.customer_id, c.name as customer_name, t.title, t.priority, t.category, t.status,
  ru.display_name as requester_name, au.display_name as assignee_name, q.name as queue_name,
  t.created_at, t.updated_at, t.version`;

const SUMMARY_JOINS = `
  from tickets t
  join customers c on c.id = t.customer_id
  join users ru on ru.id = t.requester_user_id
  left join users au on au.id = t.assignee_user_id
  left join queues q on q.id = t.queue_id`;

function toSummary(r: Record<string, unknown>): TicketSummary {
  return {
    id: r.id as string,
    number: Number(r.number),
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    title: r.title as string,
    priority: r.priority as string,
    category: r.category as string,
    status: r.status as Status,
    requesterName: r.requester_name as string,
    assigneeName: (r.assignee_name as string) ?? null,
    queueName: (r.queue_name as string) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    version: Number(r.version),
  };
}

export async function listTickets(p: Principal, raw: Partial<Record<keyof ListTicketsInput, unknown>>) {
  const f = listTicketsSchema.parse(raw);
  if (f.customerId) requireMember(p, f.customerId);
  if (p.memberships.length === 0) return { items: [] as TicketSummary[], total: 0, page: f.page, pageSize: f.pageSize };
  return withUser(p.userId, async (tx) => {
    const params: unknown[] = [];
    const where: string[] = [scopeClause(p, params)];
    if (f.customerId) {
      params.push(f.customerId);
      where.push(`t.customer_id = $${params.length}`);
    }
    if (f.status === "active") where.push(`t.status <> 'resolved'`);
    else if (f.status) {
      params.push(f.status);
      where.push(`t.status = $${params.length}`);
    }
    if (f.priority) {
      params.push(f.priority);
      where.push(`t.priority = $${params.length}`);
    }
    if (f.mine) {
      params.push(p.userId);
      where.push(`t.requester_user_id = $${params.length}`);
    }
    if (f.assigned === "me") {
      params.push(p.userId);
      where.push(`t.assignee_user_id = $${params.length}`);
    } else if (f.assigned === "unassigned") where.push("t.assignee_user_id is null");
    if (f.q) {
      const num = /^#?(\d{1,12})$/.exec(f.q);
      if (num) {
        params.push(Number(num[1]));
        where.push(`t.number = $${params.length}`);
      } else {
        // Parameterised ILIKE with escaped wildcards.
        params.push(`%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        where.push(`(t.title ilike $${params.length} or t.description ilike $${params.length})`);
      }
    }
    const whereSql = where.join(" and ");
    const total = await tx.query<{ n: string }>(`select count(*)::text as n from tickets t where ${whereSql}`, params);
    params.push(f.pageSize, (f.page - 1) * f.pageSize);
    const rows = await tx.query(
      `select ${SUMMARY_COLUMNS} ${SUMMARY_JOINS} where ${whereSql}
       order by case t.status when 'resolved' then 1 else 0 end, t.updated_at desc, t.number desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items: rows.rows.map(toSummary), total: Number(total.rows[0].n), page: f.page, pageSize: f.pageSize };
  });
}

async function loadTicketRow(tx: Queryable, p: Principal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Ticket");
  const params: unknown[] = [id];
  const r = await tx.query(
    `select ${SUMMARY_COLUMNS}, t.description, t.requester_user_id, t.assignee_user_id, t.queue_id,
            t.first_response_at, t.resolved_at, t.reopen_count
       ${SUMMARY_JOINS}
      where t.id = $1 and ${scopeClause(p, params)}`,
    params,
  );
  // Not-visible and nonexistent tickets are indistinguishable to the caller.
  if (!r.rows[0]) throw notFound("Ticket");
  return r.rows[0];
}

function reopenAllowed(resolvedAt: unknown) {
  if (!resolvedAt) return false;
  const ageMs = Date.now() - new Date(resolvedAt as string).getTime();
  return ageMs <= config().reopenWindowDays * 86400_000;
}

/** Status transitions a viewer may request (the server re-validates in updateTicket). */
function allowedStatuses(p: Principal, row: Record<string, unknown>): Status[] {
  const status = row.status as Status;
  const customerId = row.customer_id as string;
  if (isStaffFor(p, customerId)) return (["open", "in_progress", "waiting", "resolved"] as Status[]).filter((s) => s !== status);
  const role = roleFor(p, customerId);
  const ownsOrOrg = role === "client_admin" || row.requester_user_id === p.userId;
  if (!ownsOrOrg) return [];
  if (status === "resolved") return reopenAllowed(row.resolved_at) ? ["open"] : [];
  return ["resolved"];
}

export async function getTicket(p: Principal, id: string): Promise<TicketDetail> {
  return withUser(p.userId, async (tx) => {
    const row = await loadTicketRow(tx, p, id);
    const customerId = row.customer_id as string;
    const staff = isStaffFor(p, customerId);
    const msgs = await tx.query(
      `select m.id, u.display_name, m.visibility, m.body, m.created_at,
              app_author_is_staff(m.author_user_id, m.customer_id) as author_is_staff
         from ticket_messages m join users u on u.id = m.author_user_id
        where m.ticket_id = $1 and m.customer_id = $2 ${staff ? "" : "and m.visibility = 'public'"}
        order by m.created_at, m.id`,
      [id, customerId],
    );
    const events = await tx.query(
      `select e.kind, e.from_value, e.to_value, u.display_name, e.created_at
         from ticket_events e left join users u on u.id = e.actor_user_id
        where e.ticket_id = $1 order by e.created_at, e.id`,
      [id],
    );
    const devices = canSeeOrgFor(p, customerId)
      ? await tx.query(
          `select d.id, d.name, d.operating_system, d.compliance_state
             from ticket_devices td join devices d on d.id = td.device_id
            where td.ticket_id = $1 and d.customer_id = $2 order by d.name`,
          [id, customerId],
        )
      : { rows: [] as Record<string, unknown>[] };
    const statuses = allowedStatuses(p, row);
    return {
      ...toSummary(row),
      description: row.description as string,
      requesterUserId: row.requester_user_id as string,
      assigneeUserId: (row.assignee_user_id as string) ?? null,
      queueId: (row.queue_id as string) ?? null,
      firstResponseAt: iso(row.first_response_at),
      resolvedAt: iso(row.resolved_at),
      reopenCount: Number(row.reopen_count),
      messages: msgs.rows.map((m) => ({
        id: m.id as string,
        authorName: m.display_name as string,
        authorIsStaff: Boolean(m.author_is_staff),
        visibility: m.visibility as "public" | "internal",
        body: m.body as string,
        createdAt: iso(m.created_at)!,
      })),
      events: events.rows.map((e) => ({
        kind: e.kind as string,
        fromValue: (e.from_value as string) ?? null,
        toValue: (e.to_value as string) ?? null,
        actorName: (e.display_name as string) ?? null,
        createdAt: iso(e.created_at)!,
      })),
      devices: devices.rows.map((d) => ({
        id: d.id as string,
        name: d.name as string,
        operatingSystem: (d.operating_system as string) ?? null,
        complianceState: (d.compliance_state as string) ?? null,
      })),
      viewer: {
        role: roleFor(p, customerId)!,
        isStaff: staff,
        canReply: staff || row.status !== "resolved" || reopenAllowed(row.resolved_at),
        canAddInternalNote: staff,
        canChangeStatus: statuses,
        canAssign: staff,
        canLinkDevices: canSeeOrgFor(p, customerId),
        reopenAllowed: row.status === "resolved" && (staff || reopenAllowed(row.resolved_at)),
      },
    };
  });
}

function requestHash(body: unknown) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * Creates a ticket. Customer and requester are derived server-side from the
 * principal's memberships; an Idempotency-Key makes retries return the
 * original result instead of creating duplicates.
 */
export async function createTicket(p: Principal, raw: unknown, idempotencyKey: string) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
    throw new AppError(400, "bad_request", "A valid Idempotency-Key header is required.");
  }
  const input = createTicketSchema.parse(raw);
  let customerId = input.customerId;
  if (!customerId) {
    if (p.memberships.length !== 1) throw new AppError(422, "validation_failed", "Choose an organization.", { field: "customerId" });
    customerId = p.memberships[0].customerId;
  }
  requireMember(p, customerId);
  const hash = requestHash({ ...input, customerId });

  return withUser(p.userId, async (tx) => {
    const claim = await tx.query(
      `insert into idempotency_keys (user_id, scope, key, request_hash) values ($1, 'ticket.create', $2, $3)
       on conflict (user_id, scope, key) do nothing returning key`,
      [p.userId, idempotencyKey, hash],
    );
    if (claim.rows.length === 0) {
      const prior = await tx.query<{ request_hash: string; response: { id: string; number: number } | null }>(
        "select request_hash, response from idempotency_keys where user_id = $1 and scope = 'ticket.create' and key = $2",
        [p.userId, idempotencyKey],
      );
      if (prior.rows[0]?.request_hash !== hash || !prior.rows[0]?.response) {
        throw new AppError(409, "idempotency_conflict", "This request key was already used for a different request.");
      }
      return { ...prior.rows[0].response, replayed: true };
    }

    const t = await tx.query<{ id: string; number: string }>(
      `insert into tickets (customer_id, requester_user_id, title, description, priority, category)
       values ($1, $2, $3, $4, $5, $6) returning id, number`,
      [customerId, p.userId, input.title, input.description, input.priority, input.category],
    );
    const ticket = { id: t.rows[0].id, number: Number(t.rows[0].number) };
    await tx.query(
      "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, 'created', 'open')",
      [ticket.id, customerId, p.userId],
    );
    if (input.deviceId) {
      if (!canSeeOrgFor(p, customerId)) throw forbidden("You cannot link devices to tickets.");
      await linkDeviceTx(tx, p, ticket.id, customerId, input.deviceId);
    }
    await audit(tx, p, "ticket.create", customerId, "ticket", ticket.id, { number: ticket.number, priority: input.priority });
    await tx.query(
      "update idempotency_keys set status_code = 201, response = $3 where user_id = $1 and scope = 'ticket.create' and key = $2",
      [p.userId, idempotencyKey, JSON.stringify(ticket)],
    );
    return { ...ticket, replayed: false };
  });
}

export async function addMessage(p: Principal, ticketId: string, raw: unknown) {
  const input = addMessageSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const row = await loadTicketRow(tx, p, ticketId);
    const customerId = row.customer_id as string;
    const staff = isStaffFor(p, customerId);
    if (input.visibility === "internal" && !staff) throw forbidden("Only technicians can add private notes.");

    let newStatus: Status | null = null;
    if (input.visibility === "public" && !staff) {
      if (row.status === "resolved") {
        if (!reopenAllowed(row.resolved_at)) {
          throw new AppError(409, "reopen_window_closed", `This ticket was resolved more than ${config().reopenWindowDays} days ago. Please open a new request.`);
        }
        newStatus = "open";
      } else if (row.status === "waiting") newStatus = "open";
    }

    const m = await tx.query<{ id: string }>(
      `insert into ticket_messages (ticket_id, customer_id, author_user_id, visibility, body)
       values ($1, $2, $3, $4, $5) returning id`,
      [ticketId, customerId, p.userId, input.visibility, input.body],
    );
    const sets = ["updated_at = now()", "version = version + 1"];
    if (staff && input.visibility === "public") sets.push("first_response_at = coalesce(first_response_at, now())");
    if (newStatus) {
      sets.push(`status = '${newStatus}'`);
      if (row.status === "resolved") sets.push("resolved_at = null", "reopen_count = reopen_count + 1");
    }
    await tx.query(`update tickets set ${sets.join(", ")} where id = $1`, [ticketId]);
    if (newStatus) {
      await tx.query(
        "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, from_value, to_value) values ($1, $2, $3, $4, $5, $6)",
        [ticketId, customerId, p.userId, row.status === "resolved" ? "reopened" : "status_changed", row.status, newStatus],
      );
    }
    await audit(tx, p, input.visibility === "internal" ? "ticket.note" : "ticket.reply", customerId, "ticket", ticketId, {
      messageId: m.rows[0].id,
      statusChange: newStatus,
    });
    return { id: m.rows[0].id, status: (newStatus ?? row.status) as Status };
  });
}

export async function updateTicket(p: Principal, ticketId: string, raw: unknown) {
  const input = updateTicketSchema.parse(raw);
  return withUser(p.userId, async (tx) => {
    const row = await loadTicketRow(tx, p, ticketId);
    const customerId = row.customer_id as string;
    const staff = isStaffFor(p, customerId);

    if (!staff && (input.priority || input.assigneeUserId !== undefined || input.queueId !== undefined)) {
      throw forbidden("Only technicians can change priority or assignment.");
    }
    if (input.status && input.status !== row.status && !allowedStatuses(p, row).includes(input.status)) {
      if (!staff && row.status === "resolved" && input.status === "open") {
        throw new AppError(409, "reopen_window_closed", `This ticket was resolved more than ${config().reopenWindowDays} days ago. Please open a new request.`);
      }
      throw staff
        ? new AppError(422, "invalid_transition", "That status change is not allowed.")
        : forbidden("You cannot make that status change.");
    }
    if (input.assigneeUserId) {
      const ok = await tx.query(
        `select 1 from memberships where user_id = $1 and customer_id = $2 and revoked_at is null and role = any($3)`,
        [input.assigneeUserId, customerId, STAFF_ROLES],
      );
      if (!ok.rows[0]) throw new AppError(422, "validation_failed", "That person is not assigned to this customer.", { field: "assigneeUserId" });
    }

    const sets: string[] = ["updated_at = now()", "version = version + 1"];
    const params: unknown[] = [ticketId, input.expectedVersion];
    const events: [string, string | null, string | null][] = [];
    if (input.status && input.status !== row.status) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
      if (input.status === "resolved") sets.push("resolved_at = now()");
      if (row.status === "resolved") sets.push("resolved_at = null", "reopen_count = reopen_count + 1");
      events.push([row.status === "resolved" ? "reopened" : "status_changed", row.status as string, input.status]);
    }
    if (input.priority && input.priority !== row.priority) {
      params.push(input.priority);
      sets.push(`priority = $${params.length}`);
      events.push(["priority_changed", row.priority as string, input.priority]);
    }
    if (input.assigneeUserId !== undefined && input.assigneeUserId !== row.assignee_user_id) {
      params.push(input.assigneeUserId);
      sets.push(`assignee_user_id = $${params.length}`);
      events.push(["assigned", (row.assignee_user_id as string) ?? null, input.assigneeUserId]);
    }
    if (input.queueId !== undefined && input.queueId !== row.queue_id) {
      params.push(input.queueId);
      sets.push(`queue_id = $${params.length}`);
    }
    // Optimistic concurrency: the update only applies to the version the client saw.
    const u = await tx.query<{ version: number; status: Status }>(
      `update tickets set ${sets.join(", ")} where id = $1 and version = $2 returning version, status`,
      params,
    );
    if (!u.rows[0]) {
      const cur = await tx.query<{ version: number }>("select version from tickets where id = $1", [ticketId]);
      throw new AppError(409, "version_conflict", "Someone else updated this ticket. Reload to see the latest changes.", {
        currentVersion: cur.rows[0]?.version,
      });
    }
    for (const [kind, from, to] of events) {
      await tx.query(
        "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, from_value, to_value) values ($1, $2, $3, $4, $5, $6)",
        [ticketId, customerId, p.userId, kind, from, to],
      );
    }
    await audit(tx, p, "ticket.update", customerId, "ticket", ticketId, {
      changes: events.map(([k, f, t]) => ({ kind: k, from: f, to: t })),
      queueChanged: input.queueId !== undefined,
    });
    return { version: Number(u.rows[0].version), status: u.rows[0].status };
  });
}

async function linkDeviceTx(tx: Queryable, p: Principal, ticketId: string, customerId: string, deviceId: string) {
  const d = await tx.query("select 1 from devices where id = $1 and customer_id = $2 and removed_at is null", [deviceId, customerId]);
  if (!d.rows[0]) throw notFound("Device");
  await tx.query(
    "insert into ticket_devices (ticket_id, device_id, customer_id) values ($1, $2, $3) on conflict do nothing",
    [ticketId, deviceId, customerId],
  );
  await tx.query(
    "insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value) values ($1, $2, $3, 'device_linked', $4)",
    [ticketId, customerId, p.userId, deviceId],
  );
}

export async function linkDevice(p: Principal, ticketId: string, deviceId: string) {
  return withUser(p.userId, async (tx) => {
    const row = await loadTicketRow(tx, p, ticketId);
    const customerId = row.customer_id as string;
    if (!canSeeOrgFor(p, customerId)) throw forbidden("You cannot link devices to tickets.");
    await linkDeviceTx(tx, p, ticketId, customerId, deviceId);
    await tx.query("update tickets set updated_at = now(), version = version + 1 where id = $1", [ticketId]);
    await audit(tx, p, "ticket.device_link", customerId, "ticket", ticketId, { deviceId });
    return { ok: true };
  });
}

export async function listAssignableStaff(p: Principal, customerId: string) {
  requireStaff(p, customerId);
  return withUser(p.userId, async (tx) => {
    const r = await tx.query<{ id: string; display_name: string; role: string }>(
      `select u.id, u.display_name, m.role from memberships m join users u on u.id = m.user_id
        where m.customer_id = $1 and m.revoked_at is null and m.role in ('technician', 'service_manager') and u.status = 'active'
        order by u.display_name`,
      [customerId],
    );
    return r.rows.map((x) => ({ id: x.id, name: x.display_name, role: x.role }));
  });
}

export async function listQueues(p: Principal) {
  return withUser(p.userId, async (tx) => (await tx.query<{ id: string; name: string }>("select id, name from queues order by name")).rows);
}

/** Dashboard metrics computed from real rows within the viewer's scope. */
export async function dashboard(p: Principal) {
  if (p.memberships.length === 0) return null;
  return withUser(p.userId, async (tx) => {
    const params: unknown[] = [];
    const scope = scopeClause(p, params);
    params.push(p.userId);
    const me = params.length;
    const r = await tx.query<Record<string, string | null>>(
      `select
         count(*) filter (where t.status = 'open')::text as open,
         count(*) filter (where t.status = 'in_progress')::text as in_progress,
         count(*) filter (where t.status = 'waiting')::text as waiting,
         count(*) filter (where t.status = 'resolved' and t.resolved_at > now() - interval '30 days')::text as resolved_30d,
         count(*) filter (where t.status <> 'resolved' and t.assignee_user_id is null)::text as unassigned,
         count(*) filter (where t.status <> 'resolved' and t.assignee_user_id = $${me})::text as assigned_to_me,
         count(*) filter (where t.status <> 'resolved' and t.priority in ('high', 'urgent'))::text as high_priority,
         (percentile_cont(0.5) within group (order by extract(epoch from (t.first_response_at - t.created_at)))
            filter (where t.first_response_at is not null and t.created_at > now() - interval '30 days'))::text as median_first_response_s,
         count(*) filter (where t.first_response_at is not null and t.created_at > now() - interval '30 days')::text as responded_30d
       from tickets t where ${scope}`,
      params,
    );
    const x = r.rows[0];
    return {
      open: Number(x.open),
      inProgress: Number(x.in_progress),
      waiting: Number(x.waiting),
      resolved30d: Number(x.resolved_30d),
      unassigned: Number(x.unassigned),
      assignedToMe: Number(x.assigned_to_me),
      highPriority: Number(x.high_priority),
      medianFirstResponseSeconds: x.median_first_response_s === null ? null : Number(x.median_first_response_s),
      respondedSample30d: Number(x.responded_30d),
    };
  });
}

export async function listDevices(p: Principal, customerId?: string) {
  const allowed = customersWhere(p, (r) => ORG_ROLES.includes(r));
  const targets = customerId ? (allowed.includes(customerId) ? [customerId] : null) : allowed;
  if (!targets || targets.length === 0) throw forbidden("You cannot view this organization's devices.");
  return withUser(p.userId, async (tx) => {
    const d = await tx.query(
      `select d.id, d.customer_id, c.name as customer_name, d.source, d.name, d.operating_system, d.os_version,
              d.compliance_state, d.last_provider_sync_at, d.intune_managed_device_id, d.entra_device_id
         from devices d join customers c on c.id = d.customer_id
        where d.customer_id = any($1::uuid[]) and d.removed_at is null order by c.name, d.name`,
      [targets],
    );
    const s = await tx.query(
      `select s.customer_id, c.name as customer_name, s.provider, s.resource, s.status, s.last_attempt_at, s.last_success_at, s.last_error, s.records
         from sync_states s join customers c on c.id = s.customer_id where s.customer_id = any($1::uuid[]) order by c.name, s.provider`,
      [targets],
    );
    return {
      devices: d.rows.map((r) => ({
        id: r.id as string,
        customerId: r.customer_id as string,
        customerName: r.customer_name as string,
        source: r.source as string,
        name: r.name as string,
        operatingSystem: (r.operating_system as string) ?? null,
        osVersion: (r.os_version as string) ?? null,
        complianceState: (r.compliance_state as string) ?? null,
        lastProviderSyncAt: iso(r.last_provider_sync_at),
        intuneManagedDeviceId: (r.intune_managed_device_id as string) ?? null,
        entraDeviceId: (r.entra_device_id as string) ?? null,
      })),
      sync: s.rows.map((r) => ({
        customerId: r.customer_id as string,
        customerName: r.customer_name as string,
        provider: r.provider as string,
        resource: r.resource as string,
        status: r.status as string,
        lastAttemptAt: iso(r.last_attempt_at),
        lastSuccessAt: iso(r.last_success_at),
        // Provider error text is shown to staff only.
        lastError: isStaffFor(p, r.customer_id as string) ? ((r.last_error as string) ?? null) : r.last_error ? "Last synchronization failed." : null,
        records: r.records === null ? null : Number(r.records),
      })),
    };
  });
}

export async function recentAudit(p: Principal, customerId: string, limit = 50) {
  requireStaff(p, customerId);
  return withUser(p.userId, async (tx) => {
    const r = await tx.query(
      `select a.at, a.action, a.target_type, a.target_id, a.outcome, u.display_name
         from audit_events a left join users u on u.id = a.actor_user_id
        where a.customer_id = $1 order by a.at desc limit $2`,
      [customerId, limit],
    );
    return r.rows.map((x) => ({
      at: iso(x.at)!,
      action: x.action as string,
      targetType: (x.target_type as string) ?? null,
      targetId: (x.target_id as string) ?? null,
      outcome: x.outcome as string,
      actorName: (x.display_name as string) ?? null,
    }));
  });
}
