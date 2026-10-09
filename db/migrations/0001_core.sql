-- Hernandez Solutions IT Center: core schema.
-- Customers are internal records. Provider identifiers (Entra directory IDs,
-- Atera account/customer IDs, Azure subscription IDs) live in separate mapping
-- tables and are never used as the internal customer key.
-- Requires PostgreSQL 13+ (built-in gen_random_uuid()).


-- ---------------------------------------------------------------- customers
create table customers (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name         text not null check (length(name) between 1 and 200),
  status       text not null default 'active' check (status in ('active', 'offboarding', 'offboarded')),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Microsoft Entra directories (tenants). kind = 'msp' is the Hernandez
-- Solutions home directory where technicians sign in.
create table entra_directories (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null unique,
  display_name   text not null,
  kind           text not null check (kind in ('msp', 'customer')),
  sign_in_enabled boolean not null default true,
  -- Admin consent for the background inventory app registration, recorded by an operator.
  inventory_consent_at timestamptz,
  created_at     timestamptz not null default now()
);

-- A customer directory belongs to at most one internal customer.
create table customer_entra_directories (
  customer_id   uuid not null references customers(id) on delete cascade,
  directory_id  uuid not null unique references entra_directories(id) on delete cascade,
  inventory_enabled boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (customer_id, directory_id)
);

-- Azure subscriptions are a separate identifier. Recorded for reference only;
-- Graph inventory support does not imply Azure resource management.
create table customer_azure_subscriptions (
  customer_id      uuid not null references customers(id) on delete cascade,
  subscription_id  uuid not null unique,
  label            text,
  primary key (customer_id, subscription_id)
);

-- One row per Atera account (API key). The key itself lives in server-side
-- secret storage; only the *name* of the environment variable is stored.
create table atera_connections (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  api_key_env_var  text not null check (api_key_env_var ~ '^ATERA_API_KEY(_[A-Z0-9]+)?$'),
  enabled          boolean not null default true,
  created_at       timestamptz not null default now()
);

create table customer_atera_mappings (
  customer_id        uuid not null references customers(id) on delete cascade,
  connection_id      uuid not null references atera_connections(id) on delete restrict,
  atera_customer_id  bigint not null,
  verified_at        timestamptz,
  verified_name      text,
  created_at         timestamptz not null default now(),
  primary key (customer_id, connection_id),
  unique (connection_id, atera_customer_id)
);

-- ---------------------------------------------------------------- people
create table users (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  display_name         text not null,
  status               text not null default 'active' check (status in ('active', 'disabled')),
  -- Platform operator authority is separate from technician access: it grants
  -- onboarding/mapping/membership administration, not ticket visibility.
  is_platform_operator boolean not null default false,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index users_email_idx on users (lower(email));

-- Microsoft identity mapping uses (tid, oid). Never email or UPN.
create table user_identities (
  user_id     uuid not null references users(id) on delete cascade,
  tenant_id   uuid not null,
  object_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, object_id)
);
create index user_identities_user_idx on user_identities (user_id);

-- requester / client_admin are customer-side roles.
-- technician / service_manager are MSP staff explicitly assigned to a customer.
create table memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  role         text not null check (role in ('requester', 'client_admin', 'technician', 'service_manager')),
  granted_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references users(id)
);
create unique index memberships_active_uniq on memberships (user_id, customer_id) where revoked_at is null;
create index memberships_customer_idx on memberships (customer_id) where revoked_at is null;

-- Invitations bind a not-yet-seen (tid, oid) to a pre-created user. Accepting
-- requires a valid one-time code AND a sign-in from the expected directory.
create table invitations (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  user_id       uuid not null references users(id) on delete cascade,
  tenant_id     uuid not null,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_at   timestamptz
);

-- ---------------------------------------------------------------- tickets
create table queues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table tickets (
  id                  uuid primary key default gen_random_uuid(),
  number              bigserial unique,
  customer_id         uuid not null references customers(id) on delete restrict,
  requester_user_id   uuid not null references users(id),
  title               text not null check (length(title) between 3 and 200),
  description         text not null check (length(description) between 1 and 20000),
  priority            text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  category            text not null check (category in ('general', 'account_access', 'hardware', 'software', 'network', 'email', 'security', 'other')),
  status              text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'resolved')),
  assignee_user_id    uuid references users(id),
  queue_id            uuid references queues(id),
  version             integer not null default 1,
  reopen_count        integer not null default 0,
  source              text not null default 'portal' check (source in ('portal', 'atera', 'email')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  -- Tenant-aware composite key lets children prove they share the ticket's customer.
  unique (id, customer_id)
);
create index tickets_customer_status_idx on tickets (customer_id, status, updated_at desc);
create index tickets_requester_idx on tickets (requester_user_id, updated_at desc);
create index tickets_search_idx on tickets using gin (to_tsvector('simple', title || ' ' || description));

create table ticket_messages (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null,
  customer_id     uuid not null,
  author_user_id  uuid not null references users(id),
  visibility      text not null check (visibility in ('public', 'internal')),
  body            text not null check (length(body) between 1 and 20000),
  created_at      timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index ticket_messages_ticket_idx on ticket_messages (ticket_id, created_at);

-- Ticket status/assignment history (in addition to the audit log).
create table ticket_events (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null,
  customer_id     uuid not null,
  actor_user_id   uuid references users(id),
  kind            text not null check (kind in ('created', 'status_changed', 'assigned', 'reopened', 'device_linked', 'device_unlinked', 'priority_changed')),
  from_value      text,
  to_value        text,
  created_at      timestamptz not null default now(),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
create index ticket_events_ticket_idx on ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------- devices
-- Entra directory-device IDs and Intune managed-device IDs are distinct and stored separately.
create table devices (
  id                         uuid primary key default gen_random_uuid(),
  customer_id                uuid not null references customers(id) on delete cascade,
  source                     text not null check (source in ('intune', 'atera', 'demo')),
  intune_managed_device_id   text,
  entra_device_id            text,
  atera_agent_id             bigint,
  name                       text not null,
  operating_system           text,
  os_version                 text,
  compliance_state           text check (compliance_state in ('unknown', 'compliant', 'noncompliant', 'conflict', 'error', 'inGracePeriod', 'configManager')),
  last_provider_sync_at      timestamptz,
  imported_at                timestamptz not null default now(),
  removed_at                 timestamptz,
  unique (id, customer_id),
  unique (customer_id, intune_managed_device_id),
  unique (customer_id, atera_agent_id)
);

create table ticket_devices (
  ticket_id    uuid not null,
  device_id    uuid not null,
  customer_id  uuid not null,
  created_at   timestamptz not null default now(),
  primary key (ticket_id, device_id),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade,
  foreign key (device_id, customer_id) references devices (id, customer_id) on delete cascade
);

-- ---------------------------------------------------------------- audit
create table audit_events (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  actor_user_id  uuid references users(id) on delete set null,
  customer_id    uuid references customers(id) on delete set null,
  action         text not null,
  target_type    text,
  target_id      text,
  outcome        text not null default 'success' check (outcome in ('success', 'denied', 'failure')),
  details        jsonb not null default '{}'::jsonb,
  request_id     text
);
create index audit_events_customer_idx on audit_events (customer_id, at desc);
create index audit_events_action_idx on audit_events (action, at desc);

-- ---------------------------------------------------------------- auth state (durable, shared)
create table sessions (
  id_hash       text primary key,
  user_id       uuid not null references users(id) on delete cascade,
  csrf_token    text not null,
  tenant_id     uuid,
  object_id     uuid,
  method        text not null check (method in ('entra', 'demo')),
  auth_time     timestamptz not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;

create table auth_requests (
  state_hash     text primary key,
  nonce          text not null,
  code_verifier  text not null,
  return_to      text not null,
  invite_token   text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create table idempotency_keys (
  user_id       uuid not null references users(id) on delete cascade,
  key           text not null check (length(key) between 8 and 128),
  scope         text not null,
  request_hash  text not null,
  status_code   integer,
  response      jsonb,
  created_at    timestamptz not null default now(),
  primary key (user_id, scope, key)
);

create table rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (bucket, window_start)
);

-- ---------------------------------------------------------------- jobs / outbox
-- Durable queue. Provider writes are enqueued in the same transaction as the
-- business change (transactional outbox) and processed by the job runner.
create table jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  customer_id   uuid references customers(id) on delete cascade,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'needs_review', 'dead')),
  dedupe_key    text unique,
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  run_after     timestamptz not null default now(),
  locked_until  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index jobs_ready_idx on jobs (run_after) where status in ('queued', 'failed');

create table sync_states (
  customer_id       uuid not null references customers(id) on delete cascade,
  provider          text not null check (provider in ('intune', 'atera')),
  resource          text not null,
  status            text not null default 'never' check (status in ('never', 'pending', 'synchronized', 'failed', 'needs_review')),
  last_attempt_at   timestamptz,
  last_success_at   timestamptz,
  last_error        text,
  records           integer,
  skipped_records   integer,
  primary key (customer_id, provider, resource)
);

-- Links between internal tickets and provider records (for controlled sync phases).
create table provider_ticket_links (
  ticket_id         uuid not null,
  customer_id       uuid not null,
  provider          text not null check (provider in ('atera')),
  connection_id     uuid not null references atera_connections(id),
  external_id       text,
  sync_status       text not null default 'pending' check (sync_status in ('pending', 'synchronized', 'failed', 'needs_review')),
  last_synced_at    timestamptz,
  last_error        text,
  primary key (ticket_id, provider),
  unique (connection_id, external_id),
  foreign key (ticket_id, customer_id) references tickets (id, customer_id) on delete cascade
);
