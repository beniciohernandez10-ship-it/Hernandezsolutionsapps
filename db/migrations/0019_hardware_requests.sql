-- Hardware requests: named approvers per company, and a tracked path from
-- approval to delivery (approve -> order -> receive and register -> deliver).

-- ---------------------------------------------------------------- named approvers
-- People who approve catalog requests for one company (e.g. its office
-- manager). When a company has none, its client administrators approve, as
-- before. Hernandez Solutions service managers can always approve.
create table customer_approvers (
  customer_id  uuid not null references customers(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  added_by     uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (customer_id, user_id)
);

alter table customer_approvers enable row level security;
alter table customer_approvers force row level security;
-- Members may see who approves for their company ("Waiting for Jane Doe").
create policy customer_approvers_read on customer_approvers for select to itc_app using (app_role_for(customer_id) is not null);
create policy customer_approvers_owner_all on customer_approvers for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select on customer_approvers to itc_app;

-- The current user is a named approver who is still an active member.
create or replace function app_is_approver_for(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_role_for(cust) is not null
     and exists (select 1 from customer_approvers where customer_id = cust and user_id = app_user_id())
$$;

-- The company has at least one named approver who can still act.
create or replace function app_customer_has_approvers(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from customer_approvers a
      join memberships m on m.user_id = a.user_id and m.customer_id = a.customer_id and m.revoked_at is null
      join users u on u.id = a.user_id and u.status = 'active'
     where a.customer_id = cust)
$$;

-- Who may decide an approval for a company (mirrored in src/lib/catalog/read.ts).
create or replace function app_can_approve(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when app_role_for(cust) = 'service_manager' then true
    when app_customer_has_approvers(cust) then app_is_approver_for(cust)
    else coalesce(app_role_for(cust) = 'client_admin', false)
  end
$$;
-- The ticket went through approval (owner context, so the approvals policy can't recurse into tickets).
create or replace function app_ticket_has_approval(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from approvals where ticket_id = t_id)
$$;
-- Names of a company's active named approvers, for any member to read on a
-- request ("Waiting for Jane Doe"). Requesters can't list members otherwise.
create or replace function app_request_approver_names(cust uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select u.display_name from customer_approvers a
    join memberships m on m.user_id = a.user_id and m.customer_id = a.customer_id and m.revoked_at is null
    join users u on u.id = a.user_id and u.status = 'active'
   where a.customer_id = cust and app_role_for(cust) is not null
   order by u.display_name
$$;
grant execute on function app_is_approver_for(uuid), app_customer_has_approvers(uuid), app_can_approve(uuid), app_ticket_has_approval(uuid),
  app_request_approver_names(uuid) to itc_app;

drop policy approvals_decide on approvals;
create policy approvals_decide on approvals for update to itc_app
  using (status = 'pending' and app_can_approve(customer_id))
  with check (decided_by = app_user_id());

-- Named approvers see the requests that go through approval at their
-- company (to read what they're approving and reply), nothing else.
create or replace function app_ticket_visible(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tickets t
     where t.id = t_id
       and (app_can_see_org_for(t.customer_id)
            or (app_role_for(t.customer_id) = 'requester' and t.requester_user_id = app_user_id())
            or (app_is_approver_for(t.customer_id) and app_ticket_has_approval(t.id)))
  )
$$;

drop policy tickets_read on tickets;
create policy tickets_read on tickets for select to itc_app
  using (app_can_see_org_for(customer_id)
         or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id())
         or (app_is_approver_for(customer_id) and app_ticket_has_approval(tickets.id)));
drop policy tickets_update on tickets;
create policy tickets_update on tickets for update to itc_app
  using (app_can_see_org_for(customer_id)
         or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id())
         or (app_is_approver_for(customer_id) and approval_status = 'pending'))
  with check (app_can_see_org_for(customer_id)
              or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id())
              or app_is_approver_for(customer_id));

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
  if ev = 'approval_decided' and not app_can_approve(cust) then
    raise exception 'approvers only' using errcode = '42501';
  end if;
  insert into jobs (kind, customer_id, payload)
  values ('notify.ticket', cust, jsonb_build_object(
    'ticketId', t_id, 'event', ev, 'actorUserId', app_user_id(), 'detail', left(detail, 40), 'ref', ref));
end
$$;

-- ---------------------------------------------------------------- hardware workflow
alter table catalog_items add column workflow text not null default 'standard' check (workflow in ('standard', 'hardware'));

-- Where hardware requests go: one row. Queue ids aren't sensitive.
create table hardware_settings (
  id                 boolean primary key default true check (id),
  order_queue_id     uuid references queues(id) on delete set null,
  delivery_queue_id  uuid references queues(id) on delete set null,
  updated_by         uuid references users(id) on delete set null,
  updated_at         timestamptz not null default now()
);
alter table hardware_settings enable row level security;
alter table hardware_settings force row level security;
create policy hardware_settings_read on hardware_settings for select to itc_app using (true);
create policy hardware_settings_owner_all on hardware_settings for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select on hardware_settings to itc_app;

insert into queues (name) select 'Procurement' where not exists (select 1 from queues where lower(name) = 'procurement');
insert into queues (name) select 'Technicians' where not exists (select 1 from queues where lower(name) = 'technicians');
insert into hardware_settings (order_queue_id, delivery_queue_id)
select (select id from queues where lower(name) = 'procurement'), (select id from queues where lower(name) = 'technicians');

-- One per hardware request: where it is and what happened.
create table hardware_orders (
  ticket_id        uuid primary key,
  customer_id      uuid not null,
  stage            text not null default 'approval' check (stage in ('approval', 'ordering', 'ordered', 'received', 'delivered', 'cancelled')),
  vendor           text check (length(vendor) <= 120),
  order_ref        text check (length(order_ref) <= 120),
  expected_on      date,
  ordered_at       timestamptz,
  ordered_by       uuid references users(id) on delete set null,
  received_at      timestamptz,
  received_by      uuid references users(id) on delete set null,
  delivery_method  text check (delivery_method in ('tech_setup', 'user_setup')),
  delivered_at     timestamptz,
  delivered_by     uuid references users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index hardware_orders_stage_idx on hardware_orders (customer_id, stage);

alter table hardware_orders enable row level security;
alter table hardware_orders force row level security;
create policy hardware_orders_read on hardware_orders for select to itc_app using (app_ticket_visible(ticket_id));
-- Created with the request, by whoever submits it.
create policy hardware_orders_insert on hardware_orders for insert to itc_app
  with check (app_ticket_visible(ticket_id) and stage in ('approval', 'ordering') and vendor is null and ordered_at is null);
-- Staff move it along; an approver's decision moves it out of "approval" only.
create policy hardware_orders_update on hardware_orders for update to itc_app
  using (app_is_staff_for(customer_id) or (stage = 'approval' and app_can_approve(customer_id)))
  with check (app_is_staff_for(customer_id) or (stage in ('ordering', 'cancelled') and app_can_approve(customer_id)));
create policy hardware_orders_owner_all on hardware_orders for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select, insert, update on hardware_orders to itc_app;

-- Hardware received for a request. The label is a snapshot ("LAPTOP-004 ·
-- Dell Latitude 7450 · SN 5CG1234") so the requester can see what they're
-- getting without access to the asset register.
create table ticket_assets (
  ticket_id    uuid not null,
  asset_id     uuid not null,
  customer_id  uuid not null,
  label        text not null check (length(label) between 1 and 300),
  linked_by    uuid references users(id) on delete set null,
  linked_at    timestamptz not null default now(),
  primary key (ticket_id, asset_id),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade,
  foreign key (asset_id, customer_id) references assets (id, customer_id) on delete cascade
);
create index ticket_assets_asset_idx on ticket_assets (asset_id);

alter table ticket_assets enable row level security;
alter table ticket_assets force row level security;
create policy ticket_assets_read on ticket_assets for select to itc_app using (app_ticket_visible(ticket_id));
create policy ticket_assets_insert on ticket_assets for insert to itc_app
  with check (app_is_staff_for(customer_id) and linked_by = app_user_id());
create policy ticket_assets_owner_all on ticket_assets for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
grant select, insert on ticket_assets to itc_app;

-- Every kind of hardware can be a tagged asset, not just computers.
alter table assets drop constraint assets_kind_check;
alter table assets add constraint assets_kind_check
  check (kind in ('workstation', 'laptop', 'monitor', 'phone', 'tablet', 'dock', 'printer', 'accessory', 'other'));
alter table asset_counters drop constraint asset_counters_kind_check;
alter table asset_counters add constraint asset_counters_kind_check
  check (kind in ('workstation', 'laptop', 'monitor', 'phone', 'tablet', 'dock', 'printer', 'accessory', 'other'));

alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed', 'closed',
  'merged', 'merged_from', 'parent_set', 'parent_cleared', 'auto_assigned', 'incident_linked', 'incident_unlinked',
  'problem_linked', 'problem_unlinked', 'hardware_ordered', 'hardware_received', 'hardware_delivered', 'queue_changed'));

-- The "New hardware" request type (from 0005) now follows the hardware path and always needs approval.
-- Only these two settings change, so any edits to its questions or checklist are kept.
update catalog_items set workflow = 'hardware', requires_approval = true, updated_at = now() where lower(name) = 'new hardware';
