-- Change management: planned changes with risk, a maintenance window, plans,
-- approval and an outcome. Technicians create and run them; the customer's
-- administrator approves normal changes and sees scheduled maintenance.

create table change_requests (
  id                    uuid primary key default gen_random_uuid(),
  number                bigserial unique,
  customer_id           uuid not null references customers(id) on delete restrict,
  title                 text not null check (length(title) between 3 and 200),
  description           text not null check (length(description) between 1 and 20000),
  -- standard: pre-approved routine change; normal: needs the customer's approval;
  -- emergency: approved by a Hernandez Solutions service manager.
  change_type           text not null check (change_type in ('standard', 'normal', 'emergency')),
  risk                  text not null check (risk in ('low', 'medium', 'high')),
  impact                text not null default '' check (length(impact) <= 5000),
  implementation_plan   text not null default '' check (length(implementation_plan) <= 20000),
  backout_plan          text not null default '' check (length(backout_plan) <= 20000),
  planned_start         timestamptz,
  planned_end           timestamptz,
  status                text not null default 'draft' check (status in ('draft', 'pending_approval', 'scheduled', 'in_progress', 'completed', 'failed', 'cancelled', 'rejected')),
  approval_status       text not null default 'not_required' check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  approval_decided_by   uuid references users(id),
  approval_decided_at   timestamptz,
  approval_note         text check (length(approval_note) <= 2000),
  -- Show the maintenance window to the customer's people (status page, notifications).
  notify_customer       boolean not null default true,
  created_by            uuid not null references users(id),
  implementer_user_id   uuid references users(id),
  outcome_note          text check (length(outcome_note) <= 5000),
  started_at            timestamptz,
  finished_at           timestamptz,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, customer_id),
  check (planned_end is null or planned_start is null or planned_end > planned_start)
);
create index change_requests_customer_idx on change_requests (customer_id, planned_start);

create table change_events (
  id             uuid primary key default gen_random_uuid(),
  change_id      uuid not null,
  customer_id    uuid not null,
  actor_user_id  uuid references users(id),
  kind           text not null check (kind in ('created', 'submitted', 'approved', 'rejected', 'scheduled', 'started', 'completed', 'failed', 'cancelled', 'edited')),
  note           text check (length(note) <= 5000),
  created_at     timestamptz not null default now(),
  foreign key (change_id, customer_id) references change_requests (id, customer_id) on delete cascade
);
create index change_events_change_idx on change_events (change_id, created_at);

-- Tickets a change relates to (caused by, or fixing).
create table change_tickets (
  change_id    uuid not null,
  ticket_id    uuid not null,
  customer_id  uuid not null,
  primary key (change_id, ticket_id),
  foreign key (change_id, customer_id) references change_requests (id, customer_id) on delete cascade,
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);

create or replace function app_change_visible(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from change_requests c where c.id = c_id
       and (app_is_staff_for(c.customer_id) or (app_role_for(c.customer_id) = 'client_admin' and c.status <> 'draft')))
$$;

-- ---------------------------------------------------------------- notifications about changes
alter table notifications alter column ticket_id drop not null;
alter table notifications add column change_id uuid;
alter table notifications add foreign key (change_id, customer_id) references change_requests (id, customer_id) on delete cascade;
alter table notifications add constraint notifications_subject_check check ((ticket_id is null) <> (change_id is null));
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'ticket_created', 'public_reply', 'internal_note', 'status_changed', 'assigned', 'sla_warning', 'sla_breached', 'attachment_added',
  'approval_requested', 'approval_decided',
  'change_approval_requested', 'change_decided', 'change_scheduled', 'change_finished'));

drop policy notifications_own_read on notifications;
create policy notifications_own_read on notifications for select to itc_app
  using (user_id = app_user_id() and case when ticket_id is not null then app_ticket_visible(ticket_id) else app_change_visible(change_id) end);

-- ---------------------------------------------------------------- row-level security
alter table change_requests enable row level security;
alter table change_requests force row level security;
-- Evaluated on the row itself so a newly inserted change can be returned.
create policy change_requests_read on change_requests for select to itc_app
  using (app_is_staff_for(customer_id) or (app_role_for(customer_id) = 'client_admin' and status <> 'draft'));
create policy change_requests_insert on change_requests for insert to itc_app
  with check (app_is_staff_for(customer_id) and created_by = app_user_id());
create policy change_requests_update on change_requests for update to itc_app
  using (app_is_staff_for(customer_id) or (app_role_for(customer_id) = 'client_admin' and approval_status = 'pending'))
  with check (app_is_staff_for(customer_id) or app_role_for(customer_id) = 'client_admin');
create policy change_requests_owner_all on change_requests for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table change_events enable row level security;
alter table change_events force row level security;
create policy change_events_read on change_events for select to itc_app using (app_change_visible(change_id));
create policy change_events_insert on change_events for insert to itc_app
  with check (actor_user_id = app_user_id() and app_change_visible(change_id));
create policy change_events_owner_all on change_events for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table change_tickets enable row level security;
alter table change_tickets force row level security;
create policy change_tickets_read on change_tickets for select to itc_app using (app_change_visible(change_id) and app_ticket_visible(ticket_id));
create policy change_tickets_write on change_tickets for all to itc_app
  using (app_is_staff_for(customer_id)) with check (app_is_staff_for(customer_id));
create policy change_tickets_owner_all on change_tickets for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

grant select, insert, update on change_requests to itc_app;
grant usage on sequence change_requests_number_seq to itc_app;
grant select, insert on change_events to itc_app;
grant select, insert, delete on change_tickets to itc_app;
grant execute on function app_change_visible(uuid) to itc_app;

-- Queues a notify.change job from the acting user's transaction.
create or replace function app_enqueue_change_event(c_id uuid, ev text, detail text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cust uuid;
begin
  if ev not in ('change_approval_requested', 'change_decided', 'change_scheduled', 'change_finished') then
    raise exception 'unknown change event' using errcode = '22023';
  end if;
  select customer_id into cust from change_requests where id = c_id;
  if cust is null or not app_change_visible(c_id) then
    raise exception 'change not visible' using errcode = '42501';
  end if;
  insert into jobs (kind, customer_id, payload)
  values ('notify.change', cust, jsonb_build_object('changeId', c_id, 'event', ev, 'actorUserId', app_user_id(), 'detail', left(detail, 40)));
end
$$;
grant execute on function app_enqueue_change_event(uuid, text, text) to itc_app;
