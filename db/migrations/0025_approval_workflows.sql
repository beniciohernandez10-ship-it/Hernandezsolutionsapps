-- Approval workflows for catalog items: several steps in order, each with
-- one or more approvers (the company's usual approvers, a role, or a named
-- person) who decide in parallel ("any one of them" or "all of them"),
-- steps that only apply when a form answer matches, delegation while an
-- approver is away, and approving by replying to the email.

-- [{name, mode: any|all, approvers: [{type: default|role|user, role?, userId?}], condition: {field, op, value} | null}]
alter table catalog_items add column approval_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(approval_steps) = 'array');
-- The steps that applied when the request was submitted (conditions already evaluated), so later edits don't change it.
alter table tickets add column approval_plan jsonb;

-- One row per approver slot per step. A step with mode "any" is done at the
-- first approval (the other slots are cancelled); "all" needs every slot.
alter table approvals drop constraint approvals_status_check;
alter table approvals add constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'));
alter table approvals
  add column step_index        integer not null default 0,
  add column step_name         text check (length(step_name) <= 80),
  add column step_mode         text not null default 'any' check (step_mode in ('any', 'all')),
  add column slot              integer not null default 0,
  add column approver_kind     text not null default 'default' check (approver_kind in ('default', 'role', 'user')),
  add column approver_role     text check (approver_role in ('client_admin', 'service_manager')),
  add column approver_user_id  uuid references users(id) on delete set null,
  -- Set when a delegate decided for someone who was away.
  add column on_behalf_of      uuid references users(id) on delete set null,
  add column decided_via       text check (decided_via in ('portal', 'email', 'automatic')),
  -- Who is asked, as shown on the request ("Dana Diaz", "your administrator").
  add column approver_label    text check (length(approver_label) <= 200),
  add column notified_at       timestamptz;
drop index approvals_one_pending;
create unique index approvals_one_pending_slot on approvals (ticket_id, step_index, slot) where status = 'pending';
create index approvals_pending_idx on approvals (customer_id) where status = 'pending';

-- While someone is away, a colleague decides their approvals.
create table approval_delegations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  delegate_user_id  uuid not null references users(id) on delete cascade,
  starts_on         date not null,
  ends_on           date not null,
  created_at        timestamptz not null default now(),
  check (user_id <> delegate_user_id),
  check (ends_on >= starts_on)
);
create index approval_delegations_delegate_idx on approval_delegations (delegate_user_id, ends_on);
alter table approval_delegations enable row level security;
alter table approval_delegations force row level security;
create policy approval_delegations_owner_all on approval_delegations for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

-- The current user is asked to decide (or decided, or stands in for someone
-- who is asked) an approval on this ticket. Owner context: no policy recursion.
create or replace function app_is_ticket_approver(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_user_id() is not null and exists (
    select 1 from approvals a
     where a.ticket_id = t_id
       and (a.approver_user_id = app_user_id() or a.decided_by = app_user_id()
            or exists (
              select 1 from approval_delegations d
               where d.delegate_user_id = app_user_id() and (now() at time zone 'America/Los_Angeles')::date between d.starts_on and d.ends_on
                 and (d.user_id = a.approver_user_id
                      or exists (select 1 from customer_approvers ca where ca.customer_id = a.customer_id and ca.user_id = d.user_id)
                      or exists (select 1 from memberships m where m.customer_id = a.customer_id and m.user_id = d.user_id
                                   and m.revoked_at is null and m.role in ('client_admin', 'service_manager')))))
  )
$$;
grant execute on function app_is_ticket_approver(uuid) to itc_app;

create or replace function app_ticket_visible(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tickets t
     where t.id = t_id
       and (app_can_see_org_for(t.customer_id)
            or (app_role_for(t.customer_id) = 'requester' and t.requester_user_id = app_user_id())
            or (app_is_approver_for(t.customer_id) and app_ticket_has_approval(t.id))
            or (app_role_for(t.customer_id) is not null and app_is_ticket_approver(t.id)))
  )
$$;

drop policy tickets_read on tickets;
create policy tickets_read on tickets for select to itc_app
  using (app_can_see_org_for(customer_id)
         or (app_role_for(customer_id) = 'requester' and requester_user_id = app_user_id())
         or (app_is_approver_for(customer_id) and app_ticket_has_approval(tickets.id))
         or (app_role_for(customer_id) is not null and app_is_ticket_approver(tickets.id)));

-- Approval emails can be answered: the reply token then decides that approval.
alter table email_reply_tokens add column approval_id uuid references approvals(id) on delete cascade;
alter table notifications add column approval_id uuid references approvals(id) on delete set null;
