-- Service desk features: notifications, SLAs, attachments and email intake.
-- Same model as 0002: interactive requests run as itc_app under row-level
-- security; fan-out, sweeps and provider calls run as the owning role after
-- explicit checks.

-- ---------------------------------------------------------------- ticket history kinds
alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added'));

-- Where a message came from (the portal, or an email reply matched to the ticket).
alter table ticket_messages add column source text not null default 'portal' check (source in ('portal', 'email'));

-- ---------------------------------------------------------------- notifications
create table notification_preferences (
  user_id               uuid primary key references users(id) on delete cascade,
  email_enabled         boolean not null default true,
  -- Replies and status changes on requests the user is part of.
  email_ticket_updates  boolean not null default true,
  -- Staff: new requests for customers they are assigned to.
  email_new_tickets     boolean not null default true,
  -- Staff: tickets assigned to them.
  email_assignments     boolean not null default true,
  -- Staff: SLA warnings and breaches.
  email_sla             boolean not null default true,
  updated_at            timestamptz not null default now()
);

create table notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  ticket_id      uuid not null,
  kind           text not null check (kind in ('ticket_created', 'public_reply', 'internal_note', 'status_changed', 'assigned',
                                                'sla_warning', 'sla_breached', 'attachment_added')),
  actor_user_id  uuid references users(id) on delete set null,
  -- Short machine value (a status, an SLA target name). Never message text.
  detail         text check (length(detail) <= 40),
  created_at     timestamptz not null default now(),
  read_at        timestamptz,
  emailed_at     timestamptz,
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- One-time reply addresses (t-<token>@inbound domain) put in notification
-- emails. Only the hash is stored. A reply is accepted only if it arrives at a
-- live token AND comes from that token's user; the sender address alone never
-- authorises anything.
create table email_reply_tokens (
  token_hash   text primary key,
  ticket_id    uuid not null,
  customer_id  uuid not null,
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);

-- ---------------------------------------------------------------- SLAs
-- Business hours: {"1": [["08:00", "17:00"]], ...} keyed by weekday, Sunday = 0.
-- Targets: {"urgent": {"firstResponse": 60, "resolution": 240}, ...} in business minutes.
create table sla_policies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (length(name) between 1 and 100),
  time_zone       text not null,
  business_hours  jsonb not null,
  holidays        date[] not null default '{}',
  targets         jsonb not null,
  warn_percent    integer not null default 75 check (warn_percent between 1 and 99),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table customers add column sla_policy_id uuid references sla_policies(id) on delete set null;

-- Due times are computed by the server when a ticket is created and whenever
-- its clock pauses or resumes (waiting on the customer, or resolved).
alter table tickets
  add column sla_policy_id               uuid references sla_policies(id) on delete set null,
  add column first_response_due_at       timestamptz,
  add column first_response_warn_at      timestamptz,
  add column resolution_due_at           timestamptz,
  add column resolution_warn_at          timestamptz,
  add column sla_paused_since            timestamptz,
  add column sla_paused_minutes          integer not null default 0 check (sla_paused_minutes >= 0),
  add column first_response_warned_at    timestamptz,
  add column first_response_breached_at  timestamptz,
  add column resolution_warned_at        timestamptz,
  add column resolution_breached_at      timestamptz;
create index tickets_sla_open_idx on tickets (resolution_due_at) where status <> 'resolved' and sla_policy_id is not null;

-- A suggested starting policy. It is not applied to any customer: an operator
-- reviews the targets and assigns it (Administration → Service levels).
insert into sla_policies (name, time_zone, business_hours, targets) values (
  'Standard business hours (suggested)',
  'America/Los_Angeles',
  '{"1": [["08:00", "17:00"]], "2": [["08:00", "17:00"]], "3": [["08:00", "17:00"]], "4": [["08:00", "17:00"]], "5": [["08:00", "17:00"]]}',
  '{"urgent": {"firstResponse": 60, "resolution": 480}, "high": {"firstResponse": 120, "resolution": 1080},
    "normal": {"firstResponse": 240, "resolution": 2700}, "low": {"firstResponse": 480, "resolution": 5400}}'
);

-- ---------------------------------------------------------------- attachments
create table ticket_attachments (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null,
  customer_id       uuid not null,
  message_id        uuid references ticket_messages(id) on delete set null,
  uploader_user_id  uuid not null references users(id),
  visibility        text not null check (visibility in ('public', 'internal')),
  filename          text not null check (length(filename) between 1 and 200),
  -- Detected from the file's content, never taken from the browser.
  content_type      text not null,
  size_bytes        integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key       text not null unique,
  scan_status       text not null default 'not_scanned' check (scan_status in ('not_scanned', 'clean', 'quarantined')),
  source            text not null default 'portal' check (source in ('portal', 'email')),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index ticket_attachments_ticket_idx on ticket_attachments (ticket_id, created_at);

-- ---------------------------------------------------------------- email intake
-- Verified provider webhooks land here first. Nothing becomes a ticket or a
-- reply until it passes the checks in src/lib/email/inbound.ts; everything
-- else waits for a service manager.
create table inbound_emails (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('resend')),
  provider_email_id  text not null,
  message_id         text,
  from_address       text not null,
  from_name          text,
  to_addresses       text[] not null default '{}',
  subject            text,
  received_at        timestamptz not null default now(),
  status             text not null default 'received' check (status in ('received', 'attached', 'needs_review', 'converted', 'discarded', 'failed')),
  reason             text,
  body_text          text check (length(body_text) <= 20000),
  attachment_count   integer not null default 0,
  ticket_id          uuid references tickets(id) on delete set null,
  user_id            uuid references users(id) on delete set null,
  reviewed_by        uuid references users(id) on delete set null,
  reviewed_at        timestamptz,
  unique (provider, provider_email_id)
);
create index inbound_emails_review_idx on inbound_emails (received_at desc) where status = 'needs_review';

-- ---------------------------------------------------------------- enqueue from user context
-- itc_app may only enqueue jobs as staff (0002). Notifications start from any
-- ticket participant, so this narrow SECURITY DEFINER function checks that the
-- caller can see the ticket and that the event matches their role.
create or replace function app_enqueue_ticket_event(t_id uuid, ev text, detail text default null, ref uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cust uuid;
begin
  if ev not in ('created', 'public_reply', 'internal_note', 'status_changed', 'assigned', 'attachment_added') then
    raise exception 'unknown ticket event' using errcode = '22023';
  end if;
  select customer_id into cust from tickets where id = t_id;
  if cust is null or not app_ticket_visible(t_id) then
    raise exception 'ticket not visible' using errcode = '42501';
  end if;
  if ev in ('internal_note', 'assigned') and not app_is_staff_for(cust) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  insert into jobs (kind, customer_id, payload)
  values ('notify.ticket', cust, jsonb_build_object(
    'ticketId', t_id, 'event', ev, 'actorUserId', app_user_id(), 'detail', left(detail, 40), 'ref', ref));
end
$$;

-- ---------------------------------------------------------------- row-level security
-- SLA targets are internal: customers never see warning/breach history.
drop policy ticket_events_read on ticket_events;
create policy ticket_events_read on ticket_events for select to itc_app
  using (app_ticket_visible(ticket_id) and (kind not in ('sla_warning', 'sla_breached') or app_is_staff_for(customer_id)));

alter table notification_preferences enable row level security;
alter table notification_preferences force row level security;
create policy notification_preferences_own on notification_preferences for all to itc_app
  using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy notification_preferences_owner_all on notification_preferences for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table notifications enable row level security;
alter table notifications force row level security;
-- A notification disappears as soon as the user can no longer see the ticket.
create policy notifications_own_read on notifications for select to itc_app
  using (user_id = app_user_id() and app_ticket_visible(ticket_id));
create policy notifications_own_update on notifications for update to itc_app
  using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy notifications_owner_all on notifications for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table email_reply_tokens enable row level security;
alter table email_reply_tokens force row level security;
create policy email_reply_tokens_owner_all on email_reply_tokens for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table ticket_attachments enable row level security;
alter table ticket_attachments force row level security;
create policy ticket_attachments_read on ticket_attachments for select to itc_app
  using (app_ticket_visible(ticket_id) and (visibility = 'public' or app_is_staff_for(customer_id)));
create policy ticket_attachments_insert on ticket_attachments for insert to itc_app
  with check (uploader_user_id = app_user_id() and app_ticket_visible(ticket_id)
              and (visibility = 'public' or app_is_staff_for(customer_id)));
create policy ticket_attachments_owner_all on ticket_attachments for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table inbound_emails enable row level security;
alter table inbound_emails force row level security;
create policy inbound_emails_owner_all on inbound_emails for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

-- ---------------------------------------------------------------- grants
grant select, insert, update on notification_preferences to itc_app;
grant select on notifications to itc_app;
grant update (read_at) on notifications to itc_app;
grant select, insert on ticket_attachments to itc_app;
grant select on sla_policies to itc_app;
grant execute on function app_enqueue_ticket_event(uuid, text, text, uuid) to itc_app;
-- email_reply_tokens, inbound_emails: system context only.
