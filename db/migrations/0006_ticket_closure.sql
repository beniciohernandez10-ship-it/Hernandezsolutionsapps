-- Resolution details and automatic closure.
-- Resolving a ticket records what fixed it. A resolved ticket closes
-- automatically after CLOSE_AFTER_DAYS (default 5); until then the customer
-- can reply or reopen. Closed tickets can't be reopened by customers.

alter table tickets drop constraint tickets_status_check;
alter table tickets add constraint tickets_status_check check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed'));

alter table tickets
  add column resolution_note  text check (length(resolution_note) <= 5000),
  add column closed_at        timestamptz;

create index tickets_autoclose_idx on tickets (resolved_at) where status = 'resolved';

alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed',
  'sla_warning', 'sla_breached', 'attachment_added', 'approval_requested', 'approved', 'rejected', 'task_completed', 'closed'));
