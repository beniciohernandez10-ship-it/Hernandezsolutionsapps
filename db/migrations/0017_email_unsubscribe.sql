-- One-click unsubscribe. Each notification email carries a random token
-- (stored only as a hash) that turns off that kind of email, or all email,
-- for its recipient without signing in. Mail providers call it directly
-- (RFC 8058 List-Unsubscribe-Post), so it must work without a session.
create table email_unsubscribe_tokens (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  -- The notification_preferences column the email was sent under.
  category    text not null check (category in ('email_ticket_updates', 'email_new_tickets', 'email_assignments', 'email_sla')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index email_unsubscribe_tokens_expiry_idx on email_unsubscribe_tokens (expires_at);

alter table email_unsubscribe_tokens enable row level security;
alter table email_unsubscribe_tokens force row level security;
-- System context only: tokens are checked by the server, never by the app role.
create policy email_unsubscribe_tokens_owner_all on email_unsubscribe_tokens for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');
