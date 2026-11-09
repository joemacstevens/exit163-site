-- Exit 163 data layer. One database behind every channel:
-- newsletter, SMS buddy, MCP server, website, sponsor reports.
-- Only server code (service-role key) touches these tables. RLS is on with no
-- public policies, so the anon key can read nothing.

-- Places ---------------------------------------------------------------------
create table if not exists towns (
  slug        text primary key,              -- 'ridgewood', 'bergen-county' (county-wide)
  name        text not null,
  county      text not null default 'Bergen',
  state       text not null default 'NJ',
  region      text,                          -- 'Pascack Valley', 'Northern Valley', ...
  created_at  timestamptz not null default now()
);

create table if not exists venues (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  town_slug        text references towns(slug),
  address          text,
  category         text,                     -- food | family | nightlife | shopping | arts | outdoors | services
  website          text,
  phone            text,
  description      text,
  claimed          boolean not null default false,
  claimed_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (name, town_slug)
);

-- Things to do ---------------------------------------------------------------
create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  town_slug    text not null references towns(slug),
  venue_id     uuid references venues(id),
  location     text,
  category     text not null default 'other', -- family | food | nightlife | arts | sports | holiday | outdoors | shopping | community | other
  tags         text[] not null default '{}',  -- 'tree', 'menorah', 'santa', 'market', 'free', 'kids' ...
  starts_on    date,                          -- null = date not announced yet
  ends_on      date,
  time_text    text,                          -- '4:00 PM - 6:00 PM' (as published)
  cost_text    text,
  description  text,
  source_url   text,
  verified     boolean not null default false,-- confirmed for this year from a primary source
  status       text not null default 'published' check (status in ('draft','published','canceled')),
  origin       text not null default 'research', -- research | venue | reader
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (title, town_slug, starts_on)
);
create index if not exists events_starts_on_idx on events (starts_on);
create index if not exists events_town_idx on events (town_slug);

-- Money ----------------------------------------------------------------------
-- One sponsor per town per category (the iExit "one sponsor per exit" model).
create table if not exists sponsorships (
  id                     uuid primary key default gen_random_uuid(),
  town_slug              text not null references towns(slug),
  category               text not null check (category in ('food','family','nightlife','shopping','services')),
  venue_id               uuid references venues(id),
  business_name          text not null,
  contact_name           text,
  contact_email          text not null,
  pitch                  text,               -- one line shown when the sponsor is recommended
  url                    text,
  status                 text not null default 'pending' check (status in ('pending','active','canceled')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  starts_at              timestamptz,
  ends_at                timestamptz,
  created_at             timestamptz not null default now()
);
create unique index if not exists one_active_sponsor_per_slot
  on sponsorships (town_slug, category) where status = 'active';

create table if not exists claims (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid references venues(id),
  venue_name     text not null,
  town_slug      text references towns(slug),
  contact_name   text not null,
  contact_email  text not null,
  contact_phone  text,
  role           text,
  notes          text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at     timestamptz not null default now()
);

-- Every time a sponsor is shown (sponsor reports are built from this).
create table if not exists impressions (
  id              bigint generated always as identity primary key,
  sponsorship_id  uuid not null references sponsorships(id),
  channel         text not null,             -- sms | mcp | web | newsletter
  created_at      timestamptz not null default now()
);
create index if not exists impressions_sponsor_idx on impressions (sponsorship_id, created_at);

-- Demand signals: what people ask for. No phone numbers or emails here.
create table if not exists queries (
  id          bigint generated always as identity primary key,
  channel     text not null,
  town_slug   text,
  category    text,
  query_text  text,
  created_at  timestamptz not null default now()
);

-- SMS buddy ------------------------------------------------------------------
create table if not exists sms_users (
  phone          text primary key,           -- E.164
  town_slug      text references towns(slug),
  prefs          jsonb not null default '{}',
  blast_opt_in   boolean not null default false,  -- explicit JOIN for the weekly text
  opt_in_at      timestamptz,
  opted_out      boolean not null default false,  -- STOP
  opted_out_at   timestamptz,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create table if not exists sms_messages (
  id          bigint generated always as identity primary key,
  phone       text not null,
  direction   text not null check (direction in ('in','out')),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists sms_messages_phone_idx on sms_messages (phone, created_at desc);

-- Lock everything down: server-side service role only.
alter table towns         enable row level security;
alter table venues        enable row level security;
alter table events        enable row level security;
alter table sponsorships  enable row level security;
alter table claims        enable row level security;
alter table impressions   enable row level security;
alter table queries       enable row level security;
alter table sms_users     enable row level security;
alter table sms_messages  enable row level security;

-- 2026-11-09: profiles, places, recurrence -----------------------------------
alter table sms_users add column if not exists first_name text;
alter table sms_users add column if not exists email text;
alter table sms_users add column if not exists newsletter_opt_in_at timestamptz;
alter table sms_users add column if not exists ig_handle text;
alter table sms_users add column if not exists notes text;
alter table venues add column if not exists tags text[] not null default '{}';
alter table venues add column if not exists best_for text[] not null default '{}';
alter table venues add column if not exists price_text text;
alter table venues add column if not exists hours_text text;
alter table venues add column if not exists source_url text;
alter table venues add column if not exists verified boolean not null default false;
alter table venues add column if not exists status text not null default 'open';
alter table venues add column if not exists opened_on date;
alter table venues add column if not exists origin text not null default 'research';
create index if not exists venues_town_idx on venues (town_slug);
alter table events add column if not exists recurrence_text text;
alter table events add column if not exists research_batch text;
