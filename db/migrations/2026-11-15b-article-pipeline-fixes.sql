-- 2026-11-15 (b): fixes to the article-pipeline tables -------------------------
-- Run after 2026-11-15-article-pipeline.sql. Safe to run more than once.

-- 1. Entity types: the extractor returns restaurant / cafe / bar / ..., which the original check
--    ('venue','event','business','place') rejected, so no entity could be stored.
alter table verified_entities drop constraint if exists verified_entities_entity_type_check;
alter table verified_entities add constraint verified_entities_entity_type_check
  check (entity_type in ('restaurant','cafe','bar','brewery','shop','store','venue','gym','studio','event','business','place','other'));

-- 2. Stories that fell short on verification leave the writing queue with their own status,
--    instead of staying 'verified' and getting a new placeholder draft on every run.
alter table discovered_stories drop constraint if exists discovered_stories_status_check;
alter table discovered_stories add constraint discovered_stories_status_check
  check (status in ('new','processing','verified','rejected','published','needs_manual_check'));

-- 3. A draft can be published once.
create unique index if not exists published_articles_draft_uidx on published_articles (draft_id);

-- 4. The first seed list pointed at feeds that do not load for our bot (402 / 403 / 404).
--    Turn those off; `node scripts/article-pipeline-test.js seed` adds the working ones.
update discovery_sources set enabled = false, notes = coalesce(notes || ' ', '') || '[off 2026-11-15: feed refuses bots or 404s]'
 where enabled and url in (
  'https://www.northjersey.com/rss/bergen/',
  'https://patch.com/new-jersey/ridgewood/posts/feed',
  'https://www.tapinto.net/towns/ridgewood/rss.xml',
  'https://www.tapinto.net/towns/paramus/rss.xml',
  'https://bergenmama.com/feed/'
 );
