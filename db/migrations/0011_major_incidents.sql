-- Major incidents and the status page. A service manager declares an incident
-- affecting some or all customers, links the tickets it caused, and posts
-- updates; members of affected customers see it on the status page.

create table service_incidents (
  id             uuid primary key default gen_random_uuid(),
  number         bigserial unique,
  title          text not null check (length(title) between 3 and 200),
  severity       text not null check (severity in ('minor', 'major', 'critical')),
  status         text not null default 'investigating' check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  all_customers  boolean not null default false,
  created_by     uuid not null references users(id),
  started_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table service_incident_customers (
  incident_id  uuid not null references service_incidents(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  primary key (incident_id, customer_id)
);

create table service_incident_updates (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references service_incidents(id) on delete cascade,
  status       text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  body         text not null check (length(body) between 1 and 5000),
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index service_incident_updates_idx on service_incident_updates (incident_id, created_at);

alter table tickets add column major_incident_id uuid references service_incidents(id) on delete set null;
create index tickets_major_incident_idx on tickets (major_incident_id) where major_incident_id is not null;

-- Does the incident affect any customer the current user belongs to?
create or replace function app_incident_visible(i_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from service_incidents i where i.id = i_id
       and ((i.all_customers and app_is_member_anywhere())
            or exists (select 1 from service_incident_customers ic where ic.incident_id = i.id and app_role_for(ic.customer_id) is not null)))
$$;

-- Service managers of any customer run incidents.
create or replace function app_is_manager_anywhere() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join users u on u.id = m.user_id
     where m.user_id = app_user_id() and m.revoked_at is null and u.status = 'active' and m.role = 'service_manager')
$$;

-- Upcoming and current maintenance for the user's customers, with only the
-- fields a client needs (no plans). Requesters can't read change_requests.
create or replace function app_upcoming_maintenance()
returns table (id uuid, number bigint, customer_id uuid, title text, impact text, status text, planned_start timestamptz, planned_end timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.number, c.customer_id, c.title, c.impact, c.status, c.planned_start, c.planned_end
    from change_requests c
   where c.notify_customer and c.status in ('scheduled', 'in_progress')
     and app_role_for(c.customer_id) is not null
     and (c.planned_end is null or c.planned_end > now() - interval '1 day')
   order by c.planned_start nulls last
   limit 50
$$;

-- ---------------------------------------------------------------- notifications about incidents
alter table notifications add column incident_id uuid references service_incidents(id) on delete cascade;
alter table notifications drop constraint notifications_subject_check;
alter table notifications add constraint notifications_subject_check check (num_nonnulls(ticket_id, change_id, incident_id) = 1);
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'ticket_created', 'public_reply', 'internal_note', 'status_changed', 'assigned', 'sla_warning', 'sla_breached', 'attachment_added',
  'approval_requested', 'approval_decided',
  'change_approval_requested', 'change_decided', 'change_scheduled', 'change_finished',
  'incident_update'));
drop policy notifications_own_read on notifications;
create policy notifications_own_read on notifications for select to itc_app
  using (user_id = app_user_id() and case
    when ticket_id is not null then app_ticket_visible(ticket_id)
    when change_id is not null then app_change_visible(change_id)
    else app_incident_visible(incident_id) end);

alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed', 'closed',
  'merged', 'merged_from', 'parent_set', 'parent_cleared', 'auto_assigned', 'incident_linked', 'incident_unlinked'));

-- ---------------------------------------------------------------- row-level security
alter table service_incidents enable row level security;
alter table service_incidents force row level security;
create policy service_incidents_read on service_incidents for select to itc_app
  using (app_is_manager_anywhere()
         or (all_customers and app_is_member_anywhere())
         or exists (select 1 from service_incident_customers ic where ic.incident_id = id and app_role_for(ic.customer_id) is not null));
create policy service_incidents_write on service_incidents for all to itc_app
  using (app_is_manager_anywhere()) with check (app_is_manager_anywhere());
create policy service_incidents_owner_all on service_incidents for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table service_incident_customers enable row level security;
alter table service_incident_customers force row level security;
create policy service_incident_customers_read on service_incident_customers for select to itc_app
  using (app_is_manager_anywhere() or app_role_for(customer_id) is not null);
create policy service_incident_customers_write on service_incident_customers for all to itc_app
  using (app_is_manager_anywhere()) with check (app_is_manager_anywhere());
create policy service_incident_customers_owner_all on service_incident_customers for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table service_incident_updates enable row level security;
alter table service_incident_updates force row level security;
create policy service_incident_updates_read on service_incident_updates for select to itc_app
  using (app_is_manager_anywhere() or app_incident_visible(incident_id));
create policy service_incident_updates_write on service_incident_updates for insert to itc_app
  with check (app_is_manager_anywhere() and created_by = app_user_id());
create policy service_incident_updates_owner_all on service_incident_updates for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

grant select, insert, update on service_incidents to itc_app;
grant usage on sequence service_incidents_number_seq to itc_app;
grant select, insert, delete on service_incident_customers to itc_app;
grant select, insert on service_incident_updates to itc_app;
grant execute on function app_incident_visible(uuid), app_is_manager_anywhere(), app_upcoming_maintenance() to itc_app;
