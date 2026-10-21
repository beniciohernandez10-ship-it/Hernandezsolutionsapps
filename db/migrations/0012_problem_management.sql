-- Problem management (technicians only): the root cause behind repeat
-- incidents, its workaround, and the permanent fix.

create table problems (
  id               uuid primary key default gen_random_uuid(),
  number           bigserial unique,
  -- null = spans several customers (any technician may see and work it).
  customer_id      uuid references customers(id) on delete cascade,
  title            text not null check (length(title) between 3 and 200),
  description      text not null default '' check (length(description) <= 20000),
  status           text not null default 'investigating' check (status in ('investigating', 'known_error', 'resolved')),
  root_cause       text not null default '' check (length(root_cause) <= 20000),
  workaround       text not null default '' check (length(workaround) <= 20000),
  permanent_fix    text not null default '' check (length(permanent_fix) <= 20000),
  kb_article_id    uuid references kb_articles(id) on delete set null,
  owner_user_id    uuid references users(id) on delete set null,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  version          integer not null default 1
);
create index problems_customer_idx on problems (customer_id, status);

alter table tickets add column problem_id uuid references problems(id) on delete set null;
create index tickets_problem_idx on tickets (problem_id) where problem_id is not null;

alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed', 'closed',
  'merged', 'merged_from', 'parent_set', 'parent_cleared', 'auto_assigned', 'incident_linked', 'incident_unlinked',
  'problem_linked', 'problem_unlinked'));

alter table problems enable row level security;
alter table problems force row level security;
-- app_kb_writable: technicians of that customer, or any technician when not tied to one.
create policy problems_staff on problems for all to itc_app
  using (app_kb_writable(customer_id)) with check (app_kb_writable(customer_id));
create policy problems_owner_all on problems for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

grant select, insert, update on problems to itc_app;
grant usage on sequence problems_number_seq to itc_app;
