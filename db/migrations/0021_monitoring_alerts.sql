-- Monitoring alerts become tickets. Built-in checks (Intune compliance,
-- devices that stopped checking in, warranties ending, licenses running out)
-- and external tools posting to a webhook raise alerts; an alert opens a
-- ticket once, repeats are counted on the same alert, and when the condition
-- clears the ticket is told (and resolved if nobody has picked it up).

alter table tickets drop constraint tickets_source_check;
alter table tickets add constraint tickets_source_check check (source in ('portal', 'atera', 'email', 'monitoring'));

-- Non-human accounts (monitoring). Never signs in, never emailed.
alter table users add column is_system boolean not null default false;
insert into users (id, email, display_name, is_system)
values ('00000000-0000-4000-8000-0000000a1e47', 'monitoring@it-center.invalid', 'IT Center Monitoring', true)
on conflict (id) do nothing;
-- Everyone may see a system account's name (it's the requester on monitoring tickets).
create policy users_system_read on users for select to itc_app using (is_system);

-- Requesters must be members of the client, except system accounts (monitoring),
-- and only when the server itself creates the ticket, never from a user's request.
create or replace function tickets_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.customer_id <> old.customer_id then
    raise exception 'ticket customer cannot change' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.requester_user_id <> old.requester_user_id then
    raise exception 'ticket requester cannot change' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not exists (
      select 1 from memberships m
       where m.user_id = new.requester_user_id and m.customer_id = new.customer_id and m.revoked_at is null)
     and not (
      coalesce(current_setting('role', true), '') <> 'itc_app' and app_user_id() is null
      and exists (select 1 from users u where u.id = new.requester_user_id and u.is_system)) then
    raise exception 'requester is not a member of the ticket customer' using errcode = '23514';
  end if;
  if new.assignee_user_id is not null and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not exists (
        select 1 from memberships m
         where m.user_id = new.assignee_user_id and m.customer_id = new.customer_id
           and m.revoked_at is null and m.role in ('technician', 'service_manager')) then
      raise exception 'assignee is not assigned to the ticket customer' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- Rules still apply to tickets the server creates on its own (no signed-in user).
create or replace function app_apply_assignment_rules(t_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  t record;
  r record;
begin
  select id, customer_id, category, priority, kind, title, description, assignee_user_id, queue_id into t from tickets where id = t_id;
  if t.id is null then
    raise exception 'ticket not visible' using errcode = '42501';
  end if;
  -- A signed-in caller must be able to see the ticket; the server's own context may apply rules to any.
  if (current_setting('role', true) = 'itc_app' or app_user_id() is not null) and not app_ticket_visible(t_id) then
    raise exception 'ticket not visible' using errcode = '42501';
  end if;
  if t.assignee_user_id is not null then return null; end if;
  for r in
    select * from assignment_rules
     where active and (customer_id is null or customer_id = t.customer_id)
       and (match_category is null or match_category = t.category)
       and (match_priority is null or match_priority = t.priority)
       and (match_kind is null or match_kind = t.kind)
       and (match_keyword is null or position(lower(match_keyword) in lower(t.title || ' ' || t.description)) > 0)
     order by (customer_id is null), position, created_at
  loop
    if r.assign_user_id is not null and not exists (
        select 1 from memberships m where m.user_id = r.assign_user_id and m.customer_id = t.customer_id
           and m.revoked_at is null and m.role in ('technician', 'service_manager')) then
      continue;
    end if;
    update tickets set assignee_user_id = coalesce(r.assign_user_id, assignee_user_id),
                       queue_id = coalesce(r.assign_queue_id, queue_id) where id = t_id;
    insert into ticket_events (ticket_id, customer_id, actor_user_id, kind, to_value)
      values (t_id, t.customer_id, null, 'auto_assigned', r.name);
    return r.name;
  end loop;
  return null;
end
$$;

-- Per-client settings for the built-in checks. No row = the defaults.
create table monitor_settings (
  customer_id          uuid primary key references customers(id) on delete cascade,
  intune_compliance    boolean not null default true,
  -- 0 turns the check off.
  stale_device_days    integer not null default 14 check (stale_device_days between 0 and 365),
  warranty_days        integer not null default 30 check (warranty_days between 0 and 365),
  license_shortage     boolean not null default true,
  updated_by           uuid references users(id) on delete set null,
  updated_at           timestamptz not null default now()
);

-- External tools that post alerts. The token is shown once and stored as a hash.
create table alert_sources (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(name) between 1 and 120),
  -- Null: one source for many clients, matched by the Atera customer ID in each alert.
  customer_id       uuid references customers(id) on delete cascade,
  token_hash        text not null unique,
  -- Alerts at or above this severity open a ticket; below it they're only recorded.
  min_severity      text not null default 'warning' check (min_severity in ('info', 'warning', 'critical')),
  auto_resolve      boolean not null default true,
  active            boolean not null default true,
  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_received_at  timestamptz
);

create table monitor_alerts (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  source          text not null check (source in ('intune_compliance', 'device_stale', 'warranty', 'licenses', 'webhook')),
  source_id       uuid references alert_sources(id) on delete set null,
  -- Identifies "the same problem" so repeats update one alert.
  fingerprint     text not null check (length(fingerprint) between 1 and 300),
  title           text not null check (length(title) between 1 and 200),
  severity        text not null check (severity in ('info', 'warning', 'critical')),
  details         text check (length(details) <= 4000),
  device_id       uuid references devices(id) on delete set null,
  asset_id        uuid references assets(id) on delete set null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  occurrences     integer not null default 1,
  resolved_at     timestamptz,
  ticket_id       uuid references tickets(id) on delete set null
);
create unique index monitor_alerts_one_open on monitor_alerts (customer_id, fingerprint) where status = 'open';
create index monitor_alerts_customer_idx on monitor_alerts (customer_id, status, last_seen_at desc);
create index monitor_alerts_ticket_idx on monitor_alerts (ticket_id) where ticket_id is not null;

alter table monitor_alerts enable row level security;
alter table monitor_alerts force row level security;
create policy monitor_alerts_read on monitor_alerts for select to itc_app using (app_is_staff_for(customer_id));
create policy monitor_alerts_owner_all on monitor_alerts for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select on monitor_alerts to itc_app;

alter table monitor_settings enable row level security;
alter table monitor_settings force row level security;
create policy monitor_settings_owner_all on monitor_settings for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
alter table alert_sources enable row level security;
alter table alert_sources force row level security;
create policy alert_sources_owner_all on alert_sources for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed', 'closed',
  'merged', 'merged_from', 'parent_set', 'parent_cleared', 'auto_assigned', 'incident_linked', 'incident_unlinked',
  'problem_linked', 'problem_unlinked', 'hardware_ordered', 'hardware_received', 'hardware_delivered', 'queue_changed',
  'alert_repeated', 'alert_cleared'));
