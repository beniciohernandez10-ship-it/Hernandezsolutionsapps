-- Asset registry: technician-assigned device names (WRKSTN-001, LAPTOP-001),
-- primary user, location and printable QR labels. Separate from `devices`,
-- which holds provider snapshots (Intune/Atera) that come and go with syncs;
-- an asset links to a provider device by matching name at read time.

create table asset_counters (
  customer_id  uuid not null references customers(id) on delete cascade,
  kind         text not null check (kind in ('workstation', 'laptop')),
  last_number  integer not null check (last_number > 0),
  primary key (customer_id, kind)
);

create table assets (
  id                        uuid primary key default gen_random_uuid(),
  customer_id               uuid not null references customers(id) on delete cascade,
  kind                      text not null check (kind in ('workstation', 'laptop')),
  number                    integer not null check (number > 0),
  tag                       text not null check (tag ~ '^[A-Z]+-[0-9]{3,}$' and length(tag) <= 15),
  -- Short, non-secret code printed in the QR link (/a/{code}); access still requires sign-in.
  short_code                text not null unique check (short_code ~ '^[a-z2-9]{10}$'),
  status                    text not null default 'active' check (status in ('active', 'retired')),
  primary_user_source       text not null default 'none' check (primary_user_source in ('none', 'directory', 'portal')),
  primary_user_tenant_id    uuid,
  primary_user_object_id    text,
  primary_user_portal_id    uuid references users(id) on delete set null,
  primary_user_name         text,
  primary_user_upn          text,
  location                  text,
  notes                     text,
  version                   integer not null default 1,
  created_by                uuid references users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  retired_at                timestamptz,
  unique (id, customer_id),
  unique (customer_id, kind, number),
  unique (customer_id, tag)
);
create index assets_customer_idx on assets (customer_id, tag);

create table asset_events (
  id             bigserial primary key,
  asset_id       uuid not null,
  customer_id    uuid not null,
  actor_user_id  uuid references users(id) on delete set null,
  at             timestamptz not null default now(),
  action         text not null check (action in ('registered', 'user_changed', 'location_changed', 'notes_changed', 'retired', 'reactivated')),
  details        jsonb not null default '{}'::jsonb,
  foreign key (asset_id, customer_id) references assets (id, customer_id) on delete cascade
);
create index asset_events_asset_idx on asset_events (asset_id, at desc);

-- Allocates the next number for a customer and kind atomically. Only staff of
-- that customer may allocate; the row lock on asset_counters serializes
-- concurrent registrations so two technicians never receive the same number.
create or replace function app_next_asset_number(cust uuid, k text) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  -- Inside a security definer function current_user is the owner, so the
  -- caller's SET ROLE is read from the role setting instead.
  if current_setting('role', true) = 'itc_app' or app_user_id() is not null then
    if not app_is_staff_for(cust) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  insert into asset_counters (customer_id, kind, last_number) values (cust, k, 1)
  on conflict (customer_id, kind) do update set last_number = asset_counters.last_number + 1
  returning last_number into n;
  return n;
end
$$;

alter table asset_counters enable row level security;
alter table asset_counters force row level security;
create policy asset_counters_owner_all on asset_counters for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table assets enable row level security;
alter table assets force row level security;
create policy assets_read on assets for select to itc_app
  using (app_can_see_org_for(customer_id));
create policy assets_insert on assets for insert to itc_app
  with check (app_is_staff_for(customer_id) and created_by = app_user_id());
create policy assets_update on assets for update to itc_app
  using (app_is_staff_for(customer_id)) with check (app_is_staff_for(customer_id));
create policy assets_owner_all on assets for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table asset_events enable row level security;
alter table asset_events force row level security;
create policy asset_events_read on asset_events for select to itc_app
  using (app_can_see_org_for(customer_id));
create policy asset_events_insert on asset_events for insert to itc_app
  with check (app_is_staff_for(customer_id) and actor_user_id = app_user_id());
create policy asset_events_owner_all on asset_events for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

grant select, insert, update on assets to itc_app;
grant select, insert on asset_events to itc_app;
grant usage on sequence asset_events_id_seq to itc_app;
grant execute on function app_next_asset_number(uuid, text) to itc_app;
-- asset_counters: no direct itc_app access; only through app_next_asset_number.
