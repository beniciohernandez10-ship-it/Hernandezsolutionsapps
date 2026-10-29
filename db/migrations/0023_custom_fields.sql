-- Custom fields on regular tickets: extra questions per client and/or
-- category ("Cost center", "Affected location", "Asset tag"), asked on the
-- new-request form and shown on the ticket. Staff-only fields are for
-- technicians' own notes and are never shown to the client.

create table ticket_fields (
  id           uuid primary key default gen_random_uuid(),
  -- Null: every client. Null category: every category.
  customer_id  uuid references customers(id) on delete cascade,
  category     text check (category in ('general', 'account_access', 'hardware', 'software', 'network', 'email', 'security', 'other')),
  label        text not null check (length(label) between 1 and 80),
  help         text check (help is null or length(help) <= 200),
  kind         text not null check (kind in ('text', 'long_text', 'number', 'date', 'select', 'checkbox')),
  options      jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required     boolean not null default false,
  staff_only   boolean not null default false,
  position     integer not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index ticket_fields_customer_idx on ticket_fields (customer_id, position);

create table ticket_field_values (
  ticket_id    uuid not null,
  customer_id  uuid not null,
  field_id     uuid not null references ticket_fields(id) on delete cascade,
  value        text not null check (length(value) between 1 and 4000),
  updated_by   uuid references users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (ticket_id, field_id),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);

alter table ticket_fields enable row level security;
alter table ticket_fields force row level security;
-- Members see the fields that apply to their clients; staff-only fields only to that client's staff.
create policy ticket_fields_read on ticket_fields for select to itc_app
  using ((customer_id is null or app_role_for(customer_id) is not null) and (not staff_only or customer_id is null or app_is_staff_for(customer_id)));
create policy ticket_fields_owner_all on ticket_fields for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select on ticket_fields to itc_app;

create or replace function app_field_staff_only(f_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select staff_only from ticket_fields where id = f_id), true)
$$;
grant execute on function app_field_staff_only(uuid) to itc_app;

alter table ticket_field_values enable row level security;
alter table ticket_field_values force row level security;
create policy ticket_field_values_read on ticket_field_values for select to itc_app
  using (app_ticket_visible(ticket_id) and (not app_field_staff_only(field_id) or app_is_staff_for(customer_id)));
-- Anyone who can see the ticket fills in client-facing fields when creating it; staff change them afterwards.
create policy ticket_field_values_insert on ticket_field_values for insert to itc_app
  with check (app_ticket_visible(ticket_id) and (not app_field_staff_only(field_id) or app_is_staff_for(customer_id)));
create policy ticket_field_values_update on ticket_field_values for update to itc_app
  using (app_is_staff_for(customer_id)) with check (app_is_staff_for(customer_id));
create policy ticket_field_values_delete on ticket_field_values for delete to itc_app using (app_is_staff_for(customer_id));
create policy ticket_field_values_owner_all on ticket_field_values for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select, insert, update, delete on ticket_field_values to itc_app;
