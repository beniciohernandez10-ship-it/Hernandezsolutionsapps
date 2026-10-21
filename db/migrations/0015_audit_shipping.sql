-- Off-site audit log. Every audit event is also copied to a separate,
-- append-only PostgreSQL database (docs/audit-log.md); exported_at marks the
-- rows that have arrived there.
alter table audit_events add column exported_at timestamptz;
create index audit_events_unexported_idx on audit_events (id) where exported_at is null;

-- Audit rows are never deleted or rewritten here either. The only changes
-- allowed are marking a row exported and the foreign keys' "set null" when a
-- user or customer record is removed.
create function app_audit_events_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit events cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id is distinct from old.id or new.at is distinct from old.at or new.action is distinct from old.action
     or new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id
     or new.outcome is distinct from old.outcome or new.details is distinct from old.details
     or new.request_id is distinct from old.request_id
     or (new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null)
     or (new.customer_id is distinct from old.customer_id and new.customer_id is not null)
     or (old.exported_at is not null and new.exported_at is distinct from old.exported_at) then
    raise exception 'audit events cannot be changed' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger audit_events_guard before update or delete on audit_events
  for each row execute function app_audit_events_guard();

-- Shipping state shown to operators (one row).
create table audit_shipping (
  id                boolean primary key default true check (id),
  last_shipped_at   timestamptz,
  last_error        text,
  last_error_at     timestamptz,
  -- Checkpoint: the store's chain head after the last successful send. A later
  -- check compares it with the store, so rewriting the store's whole chain is
  -- still detected unless this database is changed too.
  store_seq         bigint,
  store_hash        text,
  last_verified_at  timestamptz,
  last_verify_ok    boolean,
  last_verify_note  text
);
insert into audit_shipping (id) values (true);

alter table audit_shipping enable row level security;
alter table audit_shipping force row level security;
create policy audit_shipping_owner_all on audit_shipping for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
