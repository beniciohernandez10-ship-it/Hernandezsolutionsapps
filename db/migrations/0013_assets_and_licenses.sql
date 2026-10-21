-- Asset lifecycle details and Microsoft 365 license inventory.

alter table assets
  add column manufacturer      text check (length(manufacturer) <= 80),
  add column model             text check (length(model) <= 120),
  add column serial_number     text check (length(serial_number) <= 80),
  add column purchase_date     date,
  add column warranty_expires  date;

alter table asset_events drop constraint asset_events_action_check;
alter table asset_events add constraint asset_events_action_check check (action in (
  'registered', 'user_changed', 'location_changed', 'notes_changed', 'retired', 'reactivated', 'hardware_changed'));

-- Subscribed license SKUs per customer, read from Microsoft Graph
-- (subscribedSkus; needs Organization.Read.All consent). Replaced on each sync.
create table license_inventory (
  customer_id      uuid not null references customers(id) on delete cascade,
  sku_id           uuid not null,
  sku_part_number  text not null check (length(sku_part_number) <= 120),
  enabled          integer not null default 0,
  suspended        integer not null default 0,
  warning          integer not null default 0,
  consumed         integer not null default 0,
  captured_at      timestamptz not null default now(),
  primary key (customer_id, sku_id)
);

alter table sync_states drop constraint sync_states_provider_check;
alter table sync_states add constraint sync_states_provider_check check (provider in ('intune', 'atera', 'microsoft365'));

alter table license_inventory enable row level security;
alter table license_inventory force row level security;
-- Client admins and technicians can see their organization's licenses.
create policy license_inventory_read on license_inventory for select to itc_app using (app_can_see_org_for(customer_id));
create policy license_inventory_owner_all on license_inventory for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select on license_inventory to itc_app;
