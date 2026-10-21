-- Knowledge base: articles for everyone, for one customer, or for technicians.

create table kb_articles (
  id              uuid primary key default gen_random_uuid(),
  -- null = not tied to one customer.
  customer_id     uuid references customers(id) on delete cascade,
  -- everyone: any signed-in member of any customer. customer: members of customer_id.
  -- staff: technicians (of customer_id, or any technician when null).
  audience        text not null check (audience in ('everyone', 'customer', 'staff')),
  title           text not null check (length(title) between 3 and 200),
  summary         text not null default '' check (length(summary) <= 300),
  -- Lightweight Markdown (see src/lib/kb/markdown.ts); rendered as text, never as HTML.
  body            text not null check (length(body) between 1 and 50000),
  category        text not null check (category in ('general', 'account_access', 'hardware', 'software', 'network', 'email', 'security', 'other')),
  status          text not null default 'draft' check (status in ('draft', 'published')),
  author_user_id  uuid references users(id) on delete set null,
  updated_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz,
  views           integer not null default 0,
  helpful         integer not null default 0,
  not_helpful     integer not null default 0,
  search          tsvector generated always as (
                    setweight(to_tsvector('english', title), 'A') ||
                    setweight(to_tsvector('english', summary), 'B') ||
                    setweight(to_tsvector('english', body), 'C')) stored,
  check ((audience = 'customer') = (customer_id is not null) or audience = 'staff')
);
create index kb_articles_search_idx on kb_articles using gin (search);
create index kb_articles_customer_idx on kb_articles (customer_id, status);

create table kb_feedback (
  article_id  uuid not null references kb_articles(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  helpful     boolean not null,
  created_at  timestamptz not null default now(),
  primary key (article_id, user_id)
);

create or replace function app_is_staff_anywhere() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join users u on u.id = m.user_id join customers c on c.id = m.customer_id
     where m.user_id = app_user_id() and m.revoked_at is null and u.status = 'active'
       and c.status <> 'offboarded' and m.role in ('technician', 'service_manager'))
$$;

create or replace function app_is_member_anywhere() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join users u on u.id = m.user_id join customers c on c.id = m.customer_id
     where m.user_id = app_user_id() and m.revoked_at is null and u.status = 'active' and c.status <> 'offboarded')
$$;

-- May the current user write this article (customer-specific: its technicians; otherwise any technician)?
create or replace function app_kb_writable(cust uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when cust is null then app_is_staff_anywhere() else app_is_staff_for(cust) end
$$;

create or replace function app_kb_visible(a kb_articles) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when a.status <> 'published' then app_kb_writable(a.customer_id)
    when a.audience = 'everyone' then app_is_member_anywhere()
    when a.audience = 'customer' then app_role_for(a.customer_id) is not null
    else app_kb_writable(a.customer_id)
  end
$$;

-- Counters are bumped through this function so readers need no update right on articles.
create or replace function app_kb_record_view(a_id uuid) returns void
language sql security definer set search_path = public as $$
  update kb_articles a set views = views + 1 where a.id = a_id and app_kb_visible(a)
$$;

create or replace function app_kb_feedback(a_id uuid, is_helpful boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  prior boolean;
  art kb_articles;
begin
  select * into art from kb_articles where id = a_id;
  if art.id is null or not app_kb_visible(art) or art.status <> 'published' then
    raise exception 'article not visible' using errcode = '42501';
  end if;
  select helpful into prior from kb_feedback where article_id = a_id and user_id = app_user_id();
  if prior is not null and prior = is_helpful then return; end if;
  insert into kb_feedback (article_id, user_id, helpful) values (a_id, app_user_id(), is_helpful)
    on conflict (article_id, user_id) do update set helpful = excluded.helpful, created_at = now();
  update kb_articles set
    helpful = helpful + (case when is_helpful then 1 else 0 end) - (case when prior is true then 1 else 0 end),
    not_helpful = not_helpful + (case when is_helpful then 0 else 1 end) - (case when prior is false then 1 else 0 end)
   where id = a_id;
end
$$;

alter table kb_articles enable row level security;
alter table kb_articles force row level security;
create policy kb_articles_read on kb_articles for select to itc_app using (app_kb_visible(kb_articles));
create policy kb_articles_insert on kb_articles for insert to itc_app
  with check (app_kb_writable(customer_id) and author_user_id = app_user_id());
create policy kb_articles_update on kb_articles for update to itc_app
  using (app_kb_writable(customer_id)) with check (app_kb_writable(customer_id) and updated_by = app_user_id());
create policy kb_articles_owner_all on kb_articles for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

alter table kb_feedback enable row level security;
alter table kb_feedback force row level security;
create policy kb_feedback_own on kb_feedback for select to itc_app using (user_id = app_user_id());
create policy kb_feedback_owner_all on kb_feedback for all to public
  using (current_user <> 'itc_app') with check (current_user <> 'itc_app');

grant select, insert on kb_articles to itc_app;
grant update (customer_id, audience, title, summary, body, category, status, updated_by, updated_at, published_at) on kb_articles to itc_app;
grant select on kb_feedback to itc_app;
grant execute on function app_is_staff_anywhere(), app_is_member_anywhere(), app_kb_writable(uuid), app_kb_visible(kb_articles),
  app_kb_record_view(uuid), app_kb_feedback(uuid, boolean) to itc_app;

-- ---------------------------------------------------------------- starter articles
-- From the public Help Center on thehernandezsolutions.com/help (same text),
-- published for every client. Edit or unpublish them under Knowledge.
insert into kb_articles (title, summary, body, category, audience, status, published_at) values
($kb$My computer is running slow$kb$, $kb$Quick checks that fix most slowdowns in a few minutes.$kb$, $kb$Most slowdowns come from a computer that hasn't restarted in a while, a stuck app, or too many browser tabs. Work through these in order and stop when things are back to normal.

## Try these first

- [ ] Restart the computer: Start → Power → Restart (not Shut down). This clears most temporary problems.
- [ ] Install pending updates: Settings → Windows Update. If it asks to restart, do it.
- [ ] Close apps and browser tabs you aren't using. Dozens of open tabs can slow down any computer.
- [ ] Check free disk space: open File Explorer → This PC. If the C: drive is almost full (red bar), empty the Recycle Bin and delete large files you don't need from Downloads.

## See what's using the computer

1. Press Ctrl + Shift + Esc to open Task Manager.
2. Click the CPU or Memory column to sort by usage.
3. If an app you recognise is using a lot and isn't responding, select it and choose End task. Don't end items you don't recognise.

> **Please don't install "PC cleaner" or "speed booster" apps**
> They rarely help, often cause problems, and some are malware. Your device is already managed and maintained for you.

## Still not working?

Open a request and include: When it's slow (always, or with certain apps), how long it's been happening, and anything that changed recently.$kb$, 'hardware', 'everyone', 'published', now()),
($kb$I can't sign in, or I'm getting MFA prompts$kb$, $kb$What to check when Microsoft 365 won't let you in, and when to be suspicious.$kb$, $kb$## If your password isn't accepted

- [ ] Check Caps Lock and that you're using your full work email address.
- [ ] Try signing in at office.com in a private/incognito browser window.
- [ ] If your password recently changed, sign out and back in to Outlook and Teams so they pick up the new one.
- [ ] After several failed attempts your account may lock for a short time. Wait 15 minutes before trying again.

## If you're not getting the MFA prompt

- [ ] Open the Microsoft Authenticator app. Pending requests sometimes only appear once the app is open.
- [ ] Make sure your phone has a data or Wi-Fi connection and the correct time.
- [ ] Got a new phone? Authenticator doesn't move over by itself. Submit a ticket and we'll help you set it up again.

> **Never approve a sign-in you didn't start**
> If you get an MFA prompt or number-match request when you aren't signing in, deny it and contact us right away. It usually means someone has your password.

## Still not working?

Open a request and include: The exact error message (a screenshot helps), which app or website, and whether you recently got a new phone.$kb$, 'account_access', 'everyone', 'published', now()),
($kb$Outlook isn't sending or receiving email$kb$, $kb$Fixes for stuck emails, an Outlook that says Disconnected, and missing messages.$kb$, $kb$- [ ] Check the bottom of the Outlook window. If it says Working Offline or Disconnected, go to Send / Receive and turn off Work Offline.
- [ ] Close Outlook completely and reopen it.
- [ ] Check email in a browser at outlook.office.com. If it works there, the problem is the Outlook app on this computer and a ticket will get it sorted quickly.
- [ ] Look in the Junk Email folder for missing messages.
- [ ] If an email is stuck in the Outbox, check for a very large attachment and send a link to the file in OneDrive instead.

## Still not working?

Open a request and include: Whether email works at outlook.office.com, any error text, and when it last worked.$kb$, 'email', 'everyone', 'published', now()),
($kb$The printer isn't printing$kb$, $kb$Common printer fixes before you submit a ticket.$kb$, $kb$- [ ] Check the printer is on, has paper and isn't showing an error or jam on its screen.
- [ ] Make sure you picked the right printer in the print window. Old or similar names are common.
- [ ] Open Settings → Bluetooth & devices → Printers & scanners → your printer → Open print queue, and cancel any stuck jobs.
- [ ] Restart your computer and turn the printer off and on again.
- [ ] Ask a colleague whether it prints for them. That tells us whether it's the printer or your computer.

## Still not working?

Open a request and include: Which printer, what happens when you print (nothing, error, blank pages), and whether it works for colleagues.$kb$, 'hardware', 'everyone', 'published', now()),
($kb$Wi-Fi or internet isn't working$kb$, $kb$How to tell whether it's your computer, your network or a single website.$kb$, $kb$- [ ] Try a couple of different websites. If only one doesn't load, it may be that site that's down.
- [ ] Check whether your phone or another device works on the same Wi-Fi.
- [ ] Turn Wi-Fi off and on from the network icon in the taskbar, or restart the computer.
- [ ] At home, restart your router: unplug it for 30 seconds, then plug it back in and wait a few minutes.
- [ ] If you use a VPN, disconnect and reconnect it.

## Still not working?

Open a request and include: Where you are (office or home), whether other devices on the same network work, and whether it's every website or just one.$kb$, 'network', 'everyone', 'published', now()),
($kb$I think I got a phishing email (or clicked one)$kb$, $kb$What to do with a suspicious message, and what to do immediately if you clicked.$kb$, $kb$## If you haven't clicked anything

- [ ] Don't click links, open attachments or reply.
- [ ] Use Outlook's Report button (Report → Phishing) if you have it, then delete the message.
- [ ] If it claims to be from a colleague or vendor, check with them by phone or Teams, not by replying.

## If you clicked a link or entered your password

1. Contact us immediately. Speed matters more than anything else.
2. If you entered your password, change it right away from a device you trust.
3. Don't approve any MFA prompts you didn't start.

> You won't get in trouble for reporting a mistake. Reporting quickly is exactly what keeps the company safe.

## Still not working?

Open a request and include: Mark it urgent. Include the sender, the subject, and what you clicked or entered, if anything.$kb$, 'security', 'everyone', 'published', now()),
($kb$How to get help fast$kb$, $kb$How to submit a ticket that gets solved quickly.$kb$, $kb$Every request becomes a tracked ticket, so nothing gets lost. A good ticket gets solved much faster. Include:

- [ ] What you were trying to do, and what happened instead.
- [ ] The exact error message. A screenshot is ideal (Windows key + Shift + S).
- [ ] Which device and app, and whether it affects anyone else.
- [ ] How urgent it is: can you still work, or are you blocked?

> **Never send passwords**
> We will never ask for your password. Don't include passwords or MFA codes in a ticket, email or chat.

## Still not working?

Open a request and include: What you were doing, what you expected, what happened instead, and a screenshot of any error.$kb$, 'general', 'everyone', 'published', now());
