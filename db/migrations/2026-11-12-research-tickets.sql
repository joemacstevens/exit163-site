-- 2026-11-12: research tickets and search miss counts --------------------------
-- APPLIED to the live database on 2026-11-12 (Supabase migration
-- research_tickets_and_query_result_count). The code (lib/tickets.js, lib/tools.js logQuery)
-- works without it and starts using it once it exists.
--
-- 1. research_tickets: what the text line learned it should go find out.
--      lead = a promoter, DJ, venue or organizer described their event or place
--      gap  = someone asked for something we had nothing for
--    Like `queries`, rows say what was asked or described, never who said it:
--    no phone, no name, no email (lib/tickets.js strips emails and phone numbers).
create table if not exists research_tickets (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('lead','gap')),
  channel     text not null,                 -- sms | test | mcp
  town_slug   text references towns(slug),
  category    text,                          -- nightlife | family | food | ...
  summary     text not null,                 -- "Monthly 90s party in Hackensack, first Saturdays"
  details     text,                          -- venue, DJ or host name, schedule, public handle or link
  status      text not null default 'new' check (status in ('new','researching','added','dismissed')),
  created_at  timestamptz not null default now()
);
create index if not exists research_tickets_status_idx on research_tickets (status, created_at desc);
alter table research_tickets enable row level security;

-- 2. queries.result_count: how many rows a search found. "result_count = 0" is the list of
--    asks we could not answer, with no model call needed to produce it.
alter table queries add column if not exists result_count int;
