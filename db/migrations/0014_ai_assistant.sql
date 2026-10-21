-- AI assistant (Claude). Off for every customer until a platform operator turns
-- it on, because using it sends that customer's ticket text to Anthropic.
alter table customers add column ai_enabled boolean not null default false;

-- One row per call to the model: who asked, for what, and the token usage.
-- No prompt or response text is stored here.
create table ai_requests (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  user_id        uuid references users(id) on delete set null,
  feature        text not null check (feature in ('draft_reply', 'triage', 'self_help')),
  ticket_id      uuid,
  model          text not null check (length(model) <= 80),
  outcome        text not null check (outcome in ('ok', 'refused', 'failed')),
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  created_at     timestamptz not null default now()
);
create index ai_requests_customer_idx on ai_requests (customer_id, created_at desc);

alter table ai_requests enable row level security;
alter table ai_requests force row level security;
-- Written and read by the server only (asSystem); the app role has no access.
create policy ai_requests_owner_all on ai_requests for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
