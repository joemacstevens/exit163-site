-- 2026-11-13: claim notes become draft events, reviewed at /review ---------------
-- NOT applied to the live database yet. Until it is, a claim still saves and emails as
-- before; lib/claim-notes.js skips saving what it read and says so in the logs.
--
-- 1. events.claim_id: a draft event read from an owner's "Anything coming up?" note.
--    It stays status = 'draft' (search only reads 'published') until the claim is approved
--    at /review; rejecting the claim deletes its drafts.
alter table events add column if not exists claim_id uuid references claims(id) on delete set null;
create index if not exists events_claim_idx on events (claim_id) where claim_id is not null;
create index if not exists events_draft_idx on events (created_at desc) where status = 'draft';

-- 2. claims.reading: what was read from the note that is not an event.
--      { "venue": { "hours_text": "...", "opened_on": "2026-12-05", ... },  -- proposed, applied on approval
--        "other": ["Half-price pastries after 4pm"],                         -- specials and anything else, for a person to read
--        "skipped": ["Holiday market: already over"],                        -- events we chose not to draft, and why
--        "read_at": "2026-11-13T15:04:05Z" }
alter table claims add column if not exists reading jsonb;
create index if not exists claims_pending_idx on claims (created_at desc) where status = 'pending';
