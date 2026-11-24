-- 2026-11-15: article-writer agent pipeline ----------------------------------
-- Discovery -> verification -> writing -> review -> publish pipeline for Exit 163 content.
-- Finds stories from local news sources, verifies businesses/venues, writes original snippets
-- in Exit 163 voice, and queues them for Joe's approval before publishing.

-- Sources to check on a schedule (RSS feeds, news sites, town calendars)
create table if not exists discovery_sources (
  id             bigint generated always as identity primary key,
  name           text not null,
  url            text not null unique,
  source_type    text not null check (source_type in ('rss','html','api')),
  towns          text[] not null default '{}',  -- Bergen towns this source covers
  categories     text[] not null default '{}',  -- family | food | nightlife | arts | sports | community | other
  enabled        boolean not null default true,
  check_interval text not null default 'daily' check (check_interval in ('hourly','daily','weekly')),
  last_checked   timestamptz,
  last_success   timestamptz,
  last_error     text,
  notes          text,
  created_at     timestamptz not null default now()
);
alter table discovery_sources enable row level security;

-- Raw stories found by discovery
create table if not exists discovered_stories (
  id             bigint generated always as identity primary key,
  source_id      bigint not null references discovery_sources(id) on delete cascade,
  url            text not null,
  title          text not null,
  summary        text,
  published_at   timestamptz,
  raw_content    jsonb,                       -- store original fetch result
  dedup_hash     text not null,               -- hash of normalized (url, title) for deduplication
  status         text not null default 'new' check (status in ('new','processing','verified','rejected','published')),
  created_at     timestamptz not null default now(),
  unique (dedup_hash)
);
create index if not exists discovered_stories_status_idx on discovered_stories (status, created_at);
create index if not exists discovered_stories_source_idx on discovered_stories (source_id, created_at desc);
alter table discovered_stories enable row level security;

-- Verified entity from a story (business, venue, event)
create table if not exists verified_entities (
  id                bigint generated always as identity primary key,
  story_id          bigint references discovered_stories(id) on delete cascade,
  entity_type       text not null check (entity_type in ('venue','event','business','place')),
  name              text not null,
  town_slug         text references towns(slug),
  address           text,
  website           text,
  confidence        text not null check (confidence in ('high','medium','low','unverified')),
  verification_data jsonb not null default '{}', -- search results, source links, what's unconfirmed
  second_source_url text,                       -- second source confirming this entity
  venue_id          uuid references venues(id), -- linked to existing venue if found
  created_at        timestamptz not null default now()
);
create index if not exists verified_entities_story_idx on verified_entities (story_id);
alter table verified_entities enable row level security;

-- Article drafts awaiting Joe's approval
create table if not exists article_drafts (
  id                bigint generated always as identity primary key,
  story_id          bigint references discovered_stories(id) on delete cascade,
  entity_id         bigint references verified_entities(id) on delete set null,
  town_slug         text not null references towns(slug),
  category          text not null,            -- family | food | nightlife | arts | sports | community | other
  headline          text not null,
  body              text not null,            -- the snippet in Exit 163 voice
  source_url        text not null,            -- primary source attribution
  entity_link       text,                     -- link to the actual business/venue
  second_source_url text,                     -- second source if available
  confidence        text not null check (confidence in ('high','medium','low')),
  unconfirmed_items text[] not null default '{}', -- what couldn't be verified: ['opening date', 'hours']
  raw_generation    jsonb,                    -- Claude response for debugging
  status            text not null default 'pending' check (status in ('pending','approved','rejected','published','needs_manual_check')),
  reviewed_by       text,                     -- email of who approved/rejected
  reviewed_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  published_at      timestamptz
);
create index if not exists article_drafts_status_idx on article_drafts (status, created_at);
create index if not exists article_drafts_town_idx on article_drafts (town_slug, status);
create index if not exists article_drafts_category_idx on article_drafts (category, status);
alter table article_drafts enable row level security;

-- Published articles (approved drafts)
create table if not exists published_articles (
  id                bigint generated always as identity primary key,
  draft_id          bigint not null references article_drafts(id) on delete restrict,
  town_slug         text not null references towns(slug),
  category          text not null,
  headline          text not null,
  body              text not null,
  source_url        text not null,
  entity_link       text,
  venue_id          uuid references venues(id),
  published_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists published_articles_town_idx on published_articles (town_slug, published_at desc);
create index if not exists published_articles_category_idx on published_articles (category, published_at desc);
create index if not exists published_articles_venue_idx on published_articles (venue_id) where venue_id is not null;
alter table published_articles enable row level security;

-- Pipeline run log
create table if not exists article_pipeline_runs (
  id                    bigint generated always as identity primary key,
  run_type              text not null check (run_type in ('discovery','verification','writing','publish','full')),
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  status                text not null default 'running' check (status in ('running','completed','failed')),
  stories_discovered    int not null default 0,
  entities_verified     int not null default 0,
  drafts_created        int not null default 0,
  articles_published    int not null default 0,
  error_message         text,
  dry_run               boolean not null default false,
  created_at            timestamptz not null default now()
);
create index if not exists article_pipeline_runs_started_idx on article_pipeline_runs (started_at desc);
alter table article_pipeline_runs enable row level security;
