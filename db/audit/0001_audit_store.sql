-- Append-only audit store. This runs in its OWN PostgreSQL database, separate
-- from the IT Center's, and is applied with the store owner's credentials by
-- scripts/audit-setup.ts (never by the app or a deploy).
--
-- The app connects as audit_writer, which can only call audit_append,
-- audit_verify and audit_hash_at. It cannot read, change or delete rows.
-- Each row carries the SHA-256 of the previous row's hash plus its own
-- content, so any later edit, deletion or reordering breaks the chain.

create table audit_log (
  seq            bigint primary key,
  source         text not null check (source ~ '^[a-z0-9-]{1,40}$'),
  source_id      bigint not null,
  at             timestamptz not null,
  received_at    timestamptz not null default now(),
  actor_user_id  uuid,
  customer_id    uuid,
  action         text not null,
  target_type    text,
  target_id      text,
  outcome        text not null,
  details        jsonb not null,
  request_id     text,
  prev_hash      text not null,
  hash           text not null,
  unique (source, source_id)
);
create index audit_log_customer_idx on audit_log (customer_id, at);
create index audit_log_actor_idx on audit_log (actor_user_id, at);

create table audit_chain_head (
  id    boolean primary key default true check (id),
  seq   bigint not null,
  hash  text not null
);
insert into audit_chain_head values (true, 0, repeat('0', 64));

-- Rows can't be changed or removed, by anyone, while this trigger exists.
create function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'the audit log is append-only' using errcode = 'insufficient_privilege';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_immutable();

-- The exact text that is hashed for a row (unit separator between fields).
create function audit_canonical(p_seq bigint, p_source text, p_source_id bigint, p_at timestamptz, p_actor uuid, p_customer uuid,
                                p_action text, p_target_type text, p_target_id text, p_outcome text, p_details jsonb, p_request_id text)
returns text language sql stable set search_path = public, pg_temp as $$
  select concat_ws(E'\x1f', p_seq::text, p_source, p_source_id::text,
                   to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                   coalesce(p_actor::text, ''), coalesce(p_customer::text, ''), p_action, coalesce(p_target_type, ''),
                   coalesce(p_target_id, ''), p_outcome, p_details::text, coalesce(p_request_id, ''))
$$;

create function audit_link(p_prev text, p_canonical text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_prev || E'\x1e' || p_canonical, 'UTF8')), 'hex')
$$;

-- Appends a batch of events from one source. Events already stored (same
-- source and source_id) are skipped, so a retried send never duplicates.
-- The head row lock serialises concurrent senders.
create function audit_append(p_source text, p_events jsonb)
returns table (appended integer, head_seq bigint, head_hash text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h_seq bigint;
  h_hash text;
  e jsonb;
  n integer := 0;
  v_id bigint;
  v_at timestamptz;
  v_hash text;
begin
  if p_source is null or p_source !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'invalid source';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 1000 then
    raise exception 'events must be an array of at most 1000 items';
  end if;
  select c.seq, c.hash into h_seq, h_hash from audit_chain_head c where c.id for update;
  for e in select value from jsonb_array_elements(p_events) loop
    v_id := (e->>'id')::bigint;
    if v_id is null or e->>'action' is null or e->>'at' is null then
      raise exception 'each event needs id, at and action';
    end if;
    if exists (select 1 from audit_log l where l.source = p_source and l.source_id = v_id) then
      continue;
    end if;
    v_at := (e->>'at')::timestamptz;
    v_hash := audit_link(h_hash, audit_canonical(h_seq + 1, p_source, v_id, v_at, (e->>'actor_user_id')::uuid, (e->>'customer_id')::uuid,
      e->>'action', e->>'target_type', e->>'target_id', coalesce(e->>'outcome', 'success'), coalesce(e->'details', '{}'::jsonb), e->>'request_id'));
    insert into audit_log (seq, source, source_id, at, actor_user_id, customer_id, action, target_type, target_id, outcome, details, request_id, prev_hash, hash)
    values (h_seq + 1, p_source, v_id, v_at, (e->>'actor_user_id')::uuid, (e->>'customer_id')::uuid, e->>'action', e->>'target_type',
            e->>'target_id', coalesce(e->>'outcome', 'success'), coalesce(e->'details', '{}'::jsonb), e->>'request_id', h_hash, v_hash);
    h_seq := h_seq + 1;
    h_hash := v_hash;
    n := n + 1;
  end loop;
  update audit_chain_head c set seq = h_seq, hash = h_hash where c.id;
  return query select n, h_seq, h_hash;
end $$;

-- Recomputes the whole chain. ok = false names the first row that doesn't match.
create function audit_verify()
returns table (checked bigint, ok boolean, first_bad_seq bigint, head_seq bigint, head_hash text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r audit_log%rowtype;
  prev text := repeat('0', 64);
  expected bigint := 1;
  bad bigint;
  hs bigint;
  hh text;
begin
  select c.seq, c.hash into hs, hh from audit_chain_head c where c.id;
  for r in select * from audit_log order by seq loop
    if r.seq <> expected or r.prev_hash <> prev
       or r.hash <> audit_link(prev, audit_canonical(r.seq, r.source, r.source_id, r.at, r.actor_user_id, r.customer_id, r.action,
                                                     r.target_type, r.target_id, r.outcome, r.details, r.request_id)) then
      bad := coalesce(bad, least(r.seq, expected));
      exit;
    end if;
    prev := r.hash;
    expected := expected + 1;
  end loop;
  -- Rows removed from the end show up as a head that no longer matches.
  if bad is null and (hs <> expected - 1 or hh <> prev) then
    bad := expected;
  end if;
  return query select expected - 1, bad is null, bad, hs, hh;
end $$;

-- The stored hash at one position, for comparing with a checkpoint kept elsewhere.
create function audit_hash_at(p_seq bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select hash from audit_log where seq = p_seq
$$;

-- The app's role. It gets a password and LOGIN from scripts/audit-setup.ts.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'audit_writer') then
    create role audit_writer nologin;
  end if;
end $$;

revoke all on audit_log, audit_chain_head from public;
revoke execute on function audit_append(text, jsonb), audit_verify(), audit_hash_at(bigint), audit_log_immutable(),
  audit_canonical(bigint, text, bigint, timestamptz, uuid, uuid, text, text, text, text, jsonb, text), audit_link(text, text) from public;
grant execute on function audit_append(text, jsonb), audit_verify(), audit_hash_at(bigint) to audit_writer;
