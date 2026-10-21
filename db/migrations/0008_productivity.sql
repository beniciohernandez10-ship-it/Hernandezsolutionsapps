-- Technician productivity: saved replies, parent/child and merged tickets,
-- and automatic assignment rules.

-- ---------------------------------------------------------------- saved replies
create table canned_responses (
  id           uuid primary key default gen_random_uuid(),
  -- null = available for every customer.
  customer_id  uuid references customers(id) on delete cascade,
  title        text not null check (length(title) between 1 and 120),
  body         text not null check (length(body) between 1 and 10000),
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table canned_responses enable row level security;
alter table canned_responses force row level security;
create policy canned_responses_staff on canned_responses for all to itc_app
  using (app_kb_writable(customer_id)) with check (app_kb_writable(customer_id));
create policy canned_responses_owner_all on canned_responses for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select, insert, update, delete on canned_responses to itc_app;

-- ---------------------------------------------------------------- related tickets
-- Composite keys keep parents and merge targets inside the same customer.
alter table tickets
  add column parent_ticket_id       uuid,
  add column merged_into_ticket_id  uuid,
  add foreign key (parent_ticket_id, customer_id) references tickets (id, customer_id),
  add foreign key (merged_into_ticket_id, customer_id) references tickets (id, customer_id),
  add check (parent_ticket_id is distinct from id and merged_into_ticket_id is distinct from id);
create index tickets_parent_idx on tickets (parent_ticket_id) where parent_ticket_id is not null;

alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed', 'closed',
  'merged', 'merged_from', 'parent_set', 'parent_cleared', 'auto_assigned'));

-- ---------------------------------------------------------------- assignment rules
create table assignment_rules (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(name) between 1 and 120),
  -- null = applies to every customer.
  customer_id        uuid references customers(id) on delete cascade,
  active             boolean not null default true,
  position           integer not null default 100,
  match_category     text check (match_category in ('general', 'account_access', 'hardware', 'software', 'network', 'email', 'security', 'other')),
  match_priority     text check (match_priority in ('low', 'normal', 'high', 'urgent')),
  match_kind         text check (match_kind in ('incident', 'request')),
  -- Case-insensitive substring of the title or description.
  match_keyword      text check (length(match_keyword) between 2 and 80),
  assign_user_id     uuid references users(id) on delete cascade,
  assign_queue_id    uuid references queues(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (assign_user_id is not null or assign_queue_id is not null)
);

alter table assignment_rules enable row level security;
alter table assignment_rules force row level security;
create policy assignment_rules_owner_all on assignment_rules for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

-- Applies the first matching active rule to a new, unassigned ticket. Called
-- in the creator's transaction; rules themselves stay invisible to customers.
-- A rule naming someone who isn't staff for the ticket's customer is skipped.
create or replace function app_apply_assignment_rules(t_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  t record;
  r record;
begin
  select id, customer_id, category, priority, kind, title, description, assignee_user_id, queue_id into t from tickets where id = t_id;
  if t.id is null or not app_ticket_visible(t_id) then
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
grant execute on function app_apply_assignment_rules(uuid) to itc_app;
