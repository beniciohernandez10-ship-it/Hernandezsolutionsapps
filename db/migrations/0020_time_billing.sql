-- Time tracking and billing. Technicians log time (on a ticket or general
-- work for a client); each client has at most one active contract that
-- decides how that time is billed; a month is finalized once invoiced, which
-- locks its entries.

-- How a client is billed. Amounts in US cents.
--   retainer: monthly fee covering `included_minutes` per month, overage at the hourly rate
--   block:    prepaid hours (`included_minutes` in total from `starts_on`), then the hourly rate
--   hourly:   every billable minute at the hourly rate
create table customer_contracts (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  name               text not null check (length(name) between 1 and 120),
  kind               text not null check (kind in ('retainer', 'block', 'hourly')),
  monthly_fee_cents  integer not null default 0 check (monthly_fee_cents between 0 and 100000000),
  included_minutes   integer not null default 0 check (included_minutes between 0 and 10000000),
  hourly_rate_cents  integer not null check (hourly_rate_cents between 0 and 10000000),
  -- Each entry is rounded up to this many minutes before billing (1 = exact).
  rounding_minutes   integer not null default 1 check (rounding_minutes in (1, 6, 10, 15, 30, 60)),
  starts_on          date not null,
  ends_on            date check (ends_on is null or ends_on >= starts_on),
  active             boolean not null default true,
  notes              text check (length(notes) <= 2000),
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index customer_contracts_one_active on customer_contracts (customer_id) where active;

-- A month that has been invoiced. Its entries are locked.
create table billing_exports (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  month        text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  totals       jsonb not null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (customer_id, month)
);

create table time_entries (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  -- Null for general work for the client that isn't tied to one request.
  ticket_id          uuid,
  user_id            uuid not null references users(id),
  work_date          date not null,
  minutes            integer not null check (minutes between 1 and 1440),
  billable           boolean not null default true,
  note               text check (length(note) <= 1000),
  billed_at          timestamptz,
  billing_export_id  uuid references billing_exports(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index time_entries_customer_date_idx on time_entries (customer_id, work_date);
create index time_entries_user_date_idx on time_entries (user_id, work_date);
create index time_entries_ticket_idx on time_entries (ticket_id) where ticket_id is not null;

alter table time_entries enable row level security;
alter table time_entries force row level security;
-- Technicians of the client see its time; customers never do (they get totals through the server).
create policy time_entries_read on time_entries for select to itc_app using (app_is_staff_for(customer_id));
create policy time_entries_insert on time_entries for insert to itc_app
  with check (app_is_staff_for(customer_id) and user_id = app_user_id() and billed_at is null and billing_export_id is null);
-- Your own unbilled entries; service managers can correct anyone's for their clients.
create policy time_entries_update on time_entries for update to itc_app
  using (app_is_staff_for(customer_id) and billed_at is null
         and (user_id = app_user_id() or app_role_for(customer_id) = 'service_manager'))
  with check (app_is_staff_for(customer_id) and billed_at is null and billing_export_id is null);
create policy time_entries_delete on time_entries for delete to itc_app
  using (app_is_staff_for(customer_id) and billed_at is null
         and (user_id = app_user_id() or app_role_for(customer_id) = 'service_manager'));
create policy time_entries_owner_all on time_entries for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select, insert, update, delete on time_entries to itc_app;

-- Whether a month is already invoiced for a client (so technicians can be told
-- without seeing billing data). Staff of that client only.
create or replace function app_month_locked(cust uuid, month text) returns boolean
language sql stable security definer set search_path = public as $$
  select app_is_staff_for(cust) and exists (select 1 from billing_exports where customer_id = cust and billing_exports.month = app_month_locked.month)
$$;
grant execute on function app_month_locked(uuid, text) to itc_app;

-- Contracts and billing are operator business data: server (owner) context only.
alter table customer_contracts enable row level security;
alter table customer_contracts force row level security;
create policy customer_contracts_owner_all on customer_contracts for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
alter table billing_exports enable row level security;
alter table billing_exports force row level security;
create policy billing_exports_owner_all on billing_exports for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
