-- Month-end client reports. The data is captured when the report is
-- generated (automatically after each month ends, or on demand by an
-- operator), so a report sent to a client doesn't change afterwards.
create table monthly_reports (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  month         text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  data          jsonb not null,
  generated_at  timestamptz not null default now(),
  -- Null when generated automatically at month end.
  generated_by  uuid references users(id) on delete set null,
  unique (customer_id, month)
);
create index monthly_reports_month_idx on monthly_reports (month desc);

alter table monthly_reports enable row level security;
alter table monthly_reports force row level security;
-- Operators only, through the server (asSystem); the app role has no access.
create policy monthly_reports_owner_all on monthly_reports for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
