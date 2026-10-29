-- Scheduled report emails: when a client's month-end report is generated,
-- its client administrators (the owners on the client side) can get a
-- summary by email with a link to the full report in the portal. Off per
-- client until an operator turns it on; each person can opt out.

alter table customers add column report_emails boolean not null default false;

alter table notification_preferences add column email_reports boolean not null default true;

alter table email_unsubscribe_tokens drop constraint email_unsubscribe_tokens_category_check;
alter table email_unsubscribe_tokens add constraint email_unsubscribe_tokens_category_check
  check (category in ('email_ticket_updates', 'email_new_tickets', 'email_assignments', 'email_sla', 'email_reports'));

create table report_email_log (
  report_id  uuid not null references monthly_reports(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (report_id, user_id, sent_at)
);
alter table report_email_log enable row level security;
alter table report_email_log force row level security;
create policy report_email_log_owner_all on report_email_log for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
