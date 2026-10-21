-- Satisfaction surveys: the requester rates a resolved request.

create table ticket_surveys (
  ticket_id          uuid primary key,
  customer_id        uuid not null,
  requester_user_id  uuid not null references users(id) on delete cascade,
  rating             text not null check (rating in ('good', 'bad')),
  comment            text check (length(comment) <= 2000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index ticket_surveys_customer_idx on ticket_surveys (customer_id, created_at);

alter table ticket_surveys enable row level security;
alter table ticket_surveys force row level security;
-- Customers see their own ratings; client admins and staff see the customer's.
create policy ticket_surveys_read on ticket_surveys for select to itc_app
  using (requester_user_id = app_user_id() or app_can_see_org_for(customer_id));
-- Only the requester rates, only their own ticket, and only once it's resolved (until it closes).
create policy ticket_surveys_write on ticket_surveys for insert to itc_app
  with check (requester_user_id = app_user_id() and exists (
    select 1 from tickets t where t.id = ticket_id and t.customer_id = ticket_surveys.customer_id
       and t.requester_user_id = app_user_id() and t.status = 'resolved'));
create policy ticket_surveys_change on ticket_surveys for update to itc_app
  using (requester_user_id = app_user_id())
  with check (requester_user_id = app_user_id() and exists (
    select 1 from tickets t where t.id = ticket_id and t.status = 'resolved'));
create policy ticket_surveys_owner_all on ticket_surveys for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

grant select, insert on ticket_surveys to itc_app;
grant update (rating, comment, updated_at) on ticket_surveys to itc_app;
