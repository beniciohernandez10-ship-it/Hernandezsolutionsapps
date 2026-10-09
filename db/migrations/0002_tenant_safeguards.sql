-- Database-level tenant safeguards.
--
-- Interactive requests run inside a transaction that switches to the
-- non-owner role itc_app (SET LOCAL ROLE) and sets app.user_id. Row-level
-- security below is defence in depth: the application service layer also
-- authorises every operation explicitly. System work (sign-in, sessions,
-- job processing, operator administration) runs as the owning role after its
-- own explicit authorisation checks.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'itc_app') then
    create role itc_app nologin;
  end if;
end
$$;

-- Allow the connecting (migration/owner) role to SET ROLE itc_app.
do $$
begin
  execute format('grant itc_app to %I', current_user);
exception when others then
  -- Already granted, or the platform grants role membership differently.
  null;
end
$$;

-- ---------------------------------------------------------------- helpers
create or replace function app_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Role of the current user in a customer, considering revocation, disabled
-- users and offboarded customers. SECURITY DEFINER so policies can consult
-- memberships without granting itc_app broad read access to them.
create or replace function app_role_for(cust uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role
    from memberships m
    join users u on u.id = m.user_id
    join customers c on c.id = m.customer_id
   where m.user_id = app_user_id()
     and m.customer_id = cust
     and m.revoked_at is null
     and u.status = 'active'
     and c.status <> 'offboarded'
   limit 1
$$;

create or replace function app_is_staff_for(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role_for(cust) in ('technician', 'service_manager'), false)
$$;

create or replace function app_can_see_org_for(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role_for(cust) in ('client_admin', 'technician', 'service_manager'), false)
$$;

create or replace function app_ticket_visible(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tickets t
     where t.id = t_id
       and (app_can_see_org_for(t.customer_id)
            or (app_role_for(t.customer_id) = 'requester' and t.requester_user_id = app_user_id()))
  )
$$;

create or replace function app_shares_customer_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = app_user_id() or exists (
    select 1 from memberships mine
      join memberships theirs on theirs.customer_id = mine.customer_id
     where mine.user_id = app_user_id() and mine.revoked_at is null
       and theirs.user_id = other
  )
$$;

-- Whether a message author is MSP staff for a customer, answerable only by
-- someone who is themselves a member of that customer.
create or replace function app_author_is_staff(author uuid, cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_role_for(cust) is not null and exists (
    select 1 from memberships m
     where m.user_id = author and m.customer_id = cust and m.role in ('technician', 'service_manager'))
$$;

-- ---------------------------------------------------------------- integrity triggers
create or replace function tickets_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.customer_id <> old.customer_id then
    raise exception 'ticket customer cannot change' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.requester_user_id <> old.requester_user_id then
    raise exception 'ticket requester cannot change' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not exists (
      select 1 from memberships m
       where m.user_id = new.requester_user_id and m.customer_id = new.customer_id and m.revoked_at is null) then
    raise exception 'requester is not a member of the ticket customer' using errcode = '23514';
  end if;
  if new.assignee_user_id is not null and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not exists (
        select 1 from memberships m
         where m.user_id = new.assignee_user_id and m.customer_id = new.customer_id
           and m.revoked_at is null and m.role in ('technician', 'service_manager')) then
      raise exception 'assignee is not assigned to the ticket customer' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
create trigger tickets_guard before insert or update on tickets
  for each row execute function tickets_guard();

-- ---------------------------------------------------------------- row-level security
alter table customers enable row level security;
alter table customers force row level security;
create policy customers_member_read on customers for select to itc_app
  using (app_role_for(id) is not null);
-- The owning role (system context) keeps full access.
create policy customers_owner_all on customers for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table users enable row level security;
alter table users force row level security;
create policy users_shared_read on users for select to itc_app
  using (app_shares_customer_with(id));
create policy users_owner_all on users for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table memberships enable row level security;
alter table memberships force row level security;
create policy memberships_read on memberships for select to itc_app
  using (user_id = app_user_id() or app_can_see_org_for(customer_id));
create policy memberships_owner_all on memberships for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table tickets enable row level security;
alter table tickets force row level security;
create policy tickets_read on tickets for select to itc_app
  using (app_can_see_org_for(customer_id)
         or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id()));
create policy tickets_insert on tickets for insert to itc_app
  with check (app_role_for(customer_id) is not null
              and (requester_user_id = app_user_id() or app_is_staff_for(customer_id)));
create policy tickets_update on tickets for update to itc_app
  using (app_can_see_org_for(customer_id)
         or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id()))
  with check (app_can_see_org_for(customer_id)
         or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id()));
create policy tickets_owner_all on tickets for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table ticket_messages enable row level security;
alter table ticket_messages force row level security;
create policy ticket_messages_read on ticket_messages for select to itc_app
  using (app_ticket_visible(ticket_id) and (visibility = 'public' or app_is_staff_for(customer_id)));
create policy ticket_messages_insert on ticket_messages for insert to itc_app
  with check (author_user_id = app_user_id() and app_ticket_visible(ticket_id)
              and (visibility = 'public' or app_is_staff_for(customer_id)));
create policy ticket_messages_owner_all on ticket_messages for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table ticket_events enable row level security;
alter table ticket_events force row level security;
create policy ticket_events_read on ticket_events for select to itc_app
  using (app_ticket_visible(ticket_id));
create policy ticket_events_insert on ticket_events for insert to itc_app
  with check (actor_user_id = app_user_id() and app_ticket_visible(ticket_id));
create policy ticket_events_owner_all on ticket_events for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table devices enable row level security;
alter table devices force row level security;
create policy devices_read on devices for select to itc_app
  using (app_can_see_org_for(customer_id));
create policy devices_owner_all on devices for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table ticket_devices enable row level security;
alter table ticket_devices force row level security;
create policy ticket_devices_read on ticket_devices for select to itc_app
  using (app_ticket_visible(ticket_id));
create policy ticket_devices_write on ticket_devices for all to itc_app
  using (app_is_staff_for(customer_id) or (app_ticket_visible(ticket_id) and app_can_see_org_for(customer_id)))
  with check (app_ticket_visible(ticket_id) and app_can_see_org_for(customer_id));
create policy ticket_devices_owner_all on ticket_devices for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table audit_events enable row level security;
alter table audit_events force row level security;
create policy audit_events_read on audit_events for select to itc_app
  using (customer_id is not null and app_is_staff_for(customer_id));
create policy audit_events_insert on audit_events for insert to itc_app
  with check (actor_user_id = app_user_id() and (customer_id is null or app_role_for(customer_id) is not null));
create policy audit_events_owner_all on audit_events for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;
create policy idempotency_own on idempotency_keys for all to itc_app
  using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy idempotency_owner_all on idempotency_keys for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table jobs enable row level security;
alter table jobs force row level security;
create policy jobs_enqueue on jobs for insert to itc_app
  with check (customer_id is not null and app_is_staff_for(customer_id));
create policy jobs_owner_all on jobs for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table sync_states enable row level security;
alter table sync_states force row level security;
create policy sync_states_read on sync_states for select to itc_app
  using (app_can_see_org_for(customer_id));
create policy sync_states_owner_all on sync_states for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table provider_ticket_links enable row level security;
alter table provider_ticket_links force row level security;
create policy provider_ticket_links_read on provider_ticket_links for select to itc_app
  using (app_is_staff_for(customer_id));
create policy provider_ticket_links_owner_all on provider_ticket_links for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

-- ---------------------------------------------------------------- grants (least privilege)
revoke all on all tables in schema public from itc_app;
grant usage on schema public to itc_app;
grant select on customers, users, memberships, queues, devices, sync_states, provider_ticket_links to itc_app;
grant select, insert, update on tickets to itc_app;
grant select, insert on ticket_messages, ticket_events, audit_events to itc_app;
grant select, insert, delete on ticket_devices to itc_app;
grant select, insert, update on idempotency_keys to itc_app;
grant insert on jobs to itc_app;
grant usage on sequence tickets_number_seq, audit_events_id_seq to itc_app;
grant execute on function app_user_id(), app_role_for(uuid), app_is_staff_for(uuid),
  app_can_see_org_for(uuid), app_ticket_visible(uuid), app_shares_customer_with(uuid),
  app_author_is_staff(uuid, uuid) to itc_app;
-- sessions, auth_requests, rate_limits, invitations, provider mappings: no itc_app access.
