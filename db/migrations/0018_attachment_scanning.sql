-- Malware scanning for attachments. A new file is "pending" (stored, not
-- downloadable) until a scan job marks it clean. A file with malware is
-- quarantined: its bytes are deleted and only the record remains. If scanning
-- keeps failing the file stays unavailable ("scan_failed") until retried.
alter table ticket_attachments drop constraint ticket_attachments_scan_status_check;
-- Files uploaded before scanning existed are scanned like new ones.
update ticket_attachments set scan_status = 'pending' where scan_status = 'not_scanned';
alter table ticket_attachments add constraint ticket_attachments_scan_status_check
  check (scan_status in ('pending', 'clean', 'quarantined', 'scan_failed'));
alter table ticket_attachments alter column scan_status set default 'pending';
alter table ticket_attachments
  add column scanned_at   timestamptz,
  -- Which engines decided ("built-in", "built-in + Cloudmersive").
  add column scan_engine  text,
  -- What was found, or why the scan failed. Never file content.
  add column scan_detail  text check (length(scan_detail) <= 500);
create index ticket_attachments_pending_idx on ticket_attachments (created_at) where scan_status = 'pending' and deleted_at is null;
create index ticket_attachments_sha256_idx on ticket_attachments (sha256) where deleted_at is null;

-- Queues the scan for a file the current user has just uploaded. Requesters
-- can't insert jobs directly (only staff can), so this runs as the owner and
-- checks the file is theirs and still pending.
create or replace function app_enqueue_attachment_scan(a_id uuid, notify boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  select id, customer_id, uploader_user_id, scan_status into a from ticket_attachments where id = a_id;
  if a.id is null or a.uploader_user_id is distinct from app_user_id() or a.scan_status <> 'pending' then
    raise exception 'attachment not found' using errcode = '42501';
  end if;
  insert into jobs (kind, customer_id, payload, dedupe_key)
  values ('attachment.scan', a.customer_id, jsonb_build_object('attachmentId', a.id, 'notify', notify), 'scan:' || a.id::text)
  on conflict (dedupe_key) do nothing;
end
$$;
grant execute on function app_enqueue_attachment_scan(uuid, boolean) to itc_app;

-- Files that were already stored get a scan job now.
insert into jobs (kind, customer_id, payload, dedupe_key)
select 'attachment.scan', customer_id, jsonb_build_object('attachmentId', id, 'notify', false), 'scan:' || id::text
  from ticket_attachments where scan_status = 'pending' and deleted_at is null
on conflict (dedupe_key) do nothing;
