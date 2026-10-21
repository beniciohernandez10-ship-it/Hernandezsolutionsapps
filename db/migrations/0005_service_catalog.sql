-- Service catalog: request types with their own forms, approval by the
-- customer, and a fulfilment checklist for technicians.

create table catalog_items (
  id                 uuid primary key default gen_random_uuid(),
  -- null = offered to every customer; otherwise only to that customer.
  customer_id        uuid references customers(id) on delete cascade,
  name               text not null check (length(name) between 3 and 120),
  summary            text not null default '' check (length(summary) <= 300),
  category           text not null check (category in ('general', 'account_access', 'hardware', 'software', 'network', 'email', 'security', 'other')),
  default_priority   text not null default 'normal' check (default_priority in ('low', 'normal', 'high', 'urgent')),
  -- [{key, label, type, required, options?, help?}] — validated by the app (src/lib/catalog/fields.ts).
  fields             jsonb not null default '[]',
  -- Fulfilment checklist titles, created as tasks once the request may proceed.
  tasks              jsonb not null default '[]',
  requires_approval  boolean not null default false,
  active             boolean not null default true,
  sort_order         integer not null default 100,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index catalog_items_customer_idx on catalog_items (customer_id) where active;

alter table tickets
  add column kind             text not null default 'incident' check (kind in ('incident', 'request')),
  add column catalog_item_id  uuid references catalog_items(id) on delete set null,
  -- Answers as submitted, with their labels: [{label, value}]. Kept even if the form changes later.
  add column request_data     jsonb,
  add column approval_status  text not null default 'not_required' check (approval_status in ('not_required', 'pending', 'approved', 'rejected'));

create table approvals (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null,
  customer_id   uuid not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by  uuid not null references users(id),
  decided_by    uuid references users(id),
  decided_at    timestamptz,
  note          text check (length(note) <= 2000),
  created_at    timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create unique index approvals_one_pending on approvals (ticket_id) where status = 'pending';

create table ticket_tasks (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null,
  customer_id       uuid not null,
  title             text not null check (length(title) between 1 and 200),
  position          integer not null default 0,
  done_at           timestamptz,
  done_by           uuid references users(id),
  created_at        timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index ticket_tasks_ticket_idx on ticket_tasks (ticket_id, position);

-- Event kinds and notification kinds for approvals.
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'ticket_created', 'public_reply', 'internal_note', 'status_changed', 'assigned', 'sla_warning', 'sla_breached', 'attachment_added',
  'approval_requested', 'approval_decided'));
alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed'));

create or replace function app_enqueue_ticket_event(t_id uuid, ev text, detail text default null, ref uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cust uuid;
begin
  if ev not in ('created', 'public_reply', 'internal_note', 'status_changed', 'assigned', 'attachment_added', 'approval_requested', 'approval_decided') then
    raise exception 'unknown ticket event' using errcode = '22023';
  end if;
  select customer_id into cust from tickets where id = t_id;
  if cust is null or not app_ticket_visible(t_id) then
    raise exception 'ticket not visible' using errcode = '42501';
  end if;
  if ev in ('internal_note', 'assigned') and not app_is_staff_for(cust) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if ev = 'approval_decided' and coalesce(app_role_for(cust), '') not in ('client_admin', 'service_manager') then
    raise exception 'approvers only' using errcode = '42501';
  end if;
  insert into jobs (kind, customer_id, payload)
  values ('notify.ticket', cust, jsonb_build_object(
    'ticketId', t_id, 'event', ev, 'actorUserId', app_user_id(), 'detail', left(detail, 40), 'ref', ref));
end
$$;

-- ---------------------------------------------------------------- row-level security
alter table catalog_items enable row level security;
alter table catalog_items force row level security;
create policy catalog_items_read on catalog_items for select to itc_app
  using (active and (customer_id is null or app_role_for(customer_id) is not null));
create policy catalog_items_owner_all on catalog_items for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table approvals enable row level security;
alter table approvals force row level security;
create policy approvals_read on approvals for select to itc_app using (app_ticket_visible(ticket_id));
create policy approvals_insert on approvals for insert to itc_app
  with check (requested_by = app_user_id() and app_ticket_visible(ticket_id));
-- Only a client admin, or a service manager, of the ticket's customer may decide.
create policy approvals_decide on approvals for update to itc_app
  using (status = 'pending' and app_role_for(customer_id) in ('client_admin', 'service_manager'))
  with check (decided_by = app_user_id());
create policy approvals_owner_all on approvals for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table ticket_tasks enable row level security;
alter table ticket_tasks force row level security;
-- Requesters can follow progress; only staff change the checklist.
create policy ticket_tasks_read on ticket_tasks for select to itc_app using (app_ticket_visible(ticket_id));
create policy ticket_tasks_write on ticket_tasks for all to itc_app
  using (app_is_staff_for(customer_id)) with check (app_is_staff_for(customer_id));
create policy ticket_tasks_owner_all on ticket_tasks for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

-- Whether a customer has an active client administrator (who then approves
-- its requests). Answers only yes/no, so requesters learn nothing else about
-- other members.
create or replace function app_customer_has_client_admin(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_role_for(cust) is not null and exists (
    select 1 from memberships m join users u on u.id = m.user_id
     where m.customer_id = cust and m.role = 'client_admin' and m.revoked_at is null and u.status = 'active')
$$;
grant execute on function app_customer_has_client_admin(uuid) to itc_app;

-- The fulfilment checklist comes only from the catalog item's template, and
-- only once the request may proceed (no approval needed, or approved). Callers
-- (the requester on submission, the approver on approval) can't supply titles.
create or replace function app_create_request_tasks(t_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t record;
  n integer := 0;
  title text;
begin
  select id, customer_id, catalog_item_id, approval_status into t from tickets where id = t_id;
  if t.id is null or not app_ticket_visible(t_id) then
    raise exception 'ticket not visible' using errcode = '42501';
  end if;
  if t.catalog_item_id is null or t.approval_status not in ('not_required', 'approved')
     or exists (select 1 from ticket_tasks where ticket_id = t_id) then
    return 0;
  end if;
  for title in select jsonb_array_elements_text(tasks) from catalog_items where id = t.catalog_item_id loop
    insert into ticket_tasks (ticket_id, customer_id, title, position) values (t_id, t.customer_id, left(title, 200), n);
    n := n + 1;
  end loop;
  return n;
end
$$;

grant execute on function app_create_request_tasks(uuid) to itc_app;
grant select on catalog_items to itc_app;
grant select, insert, update on approvals to itc_app;
grant select, insert, update, delete on ticket_tasks to itc_app;

-- ---------------------------------------------------------------- starter catalog
-- Templates only: operators review and edit them under Administration → Service catalog.
insert into catalog_items (name, summary, category, default_priority, requires_approval, sort_order, fields, tasks) values
('New employee setup', 'Accounts, licenses and a device for someone joining your team.', 'account_access', 'normal', true, 10,
 '[{"key":"full_name","label":"Full name","type":"text","required":true},
   {"key":"job_title","label":"Job title","type":"text","required":false},
   {"key":"start_date","label":"Start date","type":"date","required":true},
   {"key":"manager","label":"Manager","type":"text","required":false},
   {"key":"device","label":"Computer","type":"select","required":true,"options":["New laptop","New desktop","Reuse an existing computer","No computer needed"]},
   {"key":"software","label":"Software and access they need","type":"textarea","required":false,"help":"Apps, shared mailboxes, folders, printers."},
   {"key":"notes","label":"Anything else","type":"textarea","required":false}]',
 '["Create the Microsoft 365 account","Assign licenses and groups","Prepare the computer and enroll it in Intune","Install required software","Send sign-in instructions to the manager","Check in on the first day"]'),
('Employee offboarding', 'Remove access and recover data and equipment when someone leaves.', 'account_access', 'high', true, 20,
 '[{"key":"full_name","label":"Full name","type":"text","required":true},
   {"key":"last_day","label":"Last day","type":"date","required":true},
   {"key":"mailbox","label":"Their mailbox","type":"select","required":true,"options":["Convert to a shared mailbox","Forward to someone","Remove after the retention period"]},
   {"key":"forward_to","label":"Forward email and files to","type":"text","required":false},
   {"key":"device","label":"Their computer","type":"select","required":true,"options":["Returning it to the office","Shipping it back","Personal device, remove company data only","No company device"]},
   {"key":"notes","label":"Anything else","type":"textarea","required":false}]',
 '["Block sign-in at the end of the last day","Revoke sessions and sign-in methods","Handle the mailbox as requested","Transfer OneDrive files","Remove licenses","Recover and wipe the computer","Remove from groups and shared resources"]'),
('Software request', 'Get an app installed or licensed.', 'software', 'normal', true, 30,
 '[{"key":"software","label":"Software name","type":"text","required":true},
   {"key":"users","label":"Who needs it","type":"text","required":true},
   {"key":"reason","label":"What it''s for","type":"textarea","required":true},
   {"key":"licensing","label":"Licensing","type":"select","required":true,"options":["Already purchased","We need a quote","Free","Not sure"]}]',
 '["Review security and licensing","Obtain the license","Deploy the software","Confirm it works with the user"]'),
('New hardware', 'Laptops, monitors, docks and accessories.', 'hardware', 'normal', true, 40,
 '[{"key":"item","label":"What do you need","type":"select","required":true,"options":["Laptop","Desktop","Monitor","Dock","Headset","Other"]},
   {"key":"for_whom","label":"Who is it for","type":"text","required":true},
   {"key":"needed_by","label":"Needed by","type":"date","required":false},
   {"key":"details","label":"Details","type":"textarea","required":false}]',
 '["Confirm specification and quote","Order","Enroll in Intune and label the asset","Deliver and set up"]'),
('Access or permission change', 'Add or remove access to a mailbox, folder, app or system.', 'account_access', 'normal', true, 50,
 '[{"key":"person","label":"Person","type":"text","required":true},
   {"key":"resource","label":"Access to what","type":"textarea","required":true,"help":"For example a shared mailbox, a Teams site or a folder."},
   {"key":"level","label":"Change","type":"select","required":true,"options":["Read only","Edit","Full control","Remove access"]},
   {"key":"until","label":"Until (leave blank if permanent)","type":"date","required":false}]',
 '["Verify the request","Make the change","Confirm with the requester"]'),
('Password reset or account unlock', 'Locked out or forgot your password.', 'account_access', 'high', false, 60,
 '[{"key":"account","label":"Account (sign-in name)","type":"text","required":true,"help":"Never send a password."},
   {"key":"callback","label":"Best phone number to reach you","type":"text","required":true}]',
 '["Verify identity by calling the number on file","Reset or unlock the account","Confirm sign-in works"]');
