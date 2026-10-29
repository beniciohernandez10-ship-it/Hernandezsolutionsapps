-- Recurring tickets: maintenance that happens on a schedule (monthly patch
-- review, quarterly access review, yearly license renewal) opens a request by
-- itself on each date, from the IT Center Scheduler account or a named
-- requester, with an optional checklist.

alter table tickets drop constraint tickets_source_check;
alter table tickets add constraint tickets_source_check check (source in ('portal', 'atera', 'email', 'monitoring', 'scheduled'));

insert into users (id, email, display_name, is_system)
values ('00000000-0000-4000-8000-00000005c4ed', 'scheduler@it-center.invalid', 'IT Center Scheduler', true)
on conflict (id) do nothing;

create table recurring_tickets (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  title              text not null check (length(title) between 3 and 200),
  description        text not null default '' check (length(description) <= 20000),
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  category           text not null default 'general'
                     check (category in ('general', 'account_access', 'hardware', 'software', 'network', 'email', 'security', 'other')),
  -- Null: the IT Center Scheduler account is the requester.
  requester_user_id  uuid references users(id) on delete set null,
  assignee_user_id   uuid references users(id) on delete set null,
  queue_id           uuid references queues(id) on delete set null,
  -- Checklist items, created as the ticket's tasks.
  tasks              jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array'),
  frequency          text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count     integer not null default 1 check (interval_count between 1 and 12),
  starts_on          date not null,
  ends_on            date check (ends_on is null or ends_on >= starts_on),
  -- Occurrences are counted from starts_on, so "the 31st" stays the last day of short months.
  runs               integer not null default 0,
  next_run_on        date,
  skip_if_open       boolean not null default true,
  active             boolean not null default true,
  last_run_on        date,
  last_ticket_id     uuid references tickets(id) on delete set null,
  last_outcome       text check (last_outcome in ('created', 'skipped_open')),
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index recurring_tickets_due_idx on recurring_tickets (next_run_on) where active;
create index recurring_tickets_customer_idx on recurring_tickets (customer_id);

alter table recurring_tickets enable row level security;
alter table recurring_tickets force row level security;
create policy recurring_tickets_read on recurring_tickets for select to itc_app using (app_is_staff_for(customer_id));
create policy recurring_tickets_owner_all on recurring_tickets for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select on recurring_tickets to itc_app;
