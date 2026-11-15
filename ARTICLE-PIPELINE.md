# Exit 163 Article Pipeline

Automated article-writer agent for discovering, verifying, and publishing local Bergen County stories.

## Overview

The article pipeline automates the creation of Exit 163 content by:

1. **Discovery**: Fetching candidate stories from local news RSS feeds and sources
2. **Verification**: Confirming businesses/venues are real, resolving links and towns
3. **Writing**: Generating original article snippets in Exit 163 voice using Claude
4. **Review**: Human approval workflow (Joe reviews, approves/rejects)
5. **Publishing**: Approved articles stored for newsletter/MCP/SMS integration

## Architecture

### Database Tables

- `discovery_sources` - RSS feeds and sources to check
- `discovered_stories` - Raw stories found, deduplicated by URL+title hash
- `verified_entities` - Verified businesses/venues with confidence scores
- `article_drafts` - Written articles awaiting approval
- `published_articles` - Approved and published content
- `article_pipeline_runs` - Execution logs and metrics

See `db/migrations/2026-11-15-article-pipeline.sql` for full schema.

### Libraries

- **`lib/discovery.js`** - Fetch from RSS feeds, deduplicate, filter to Bergen County
- **`lib/verification.js`** - Extract entities, verify against existing venues, resolve towns
- **`lib/writer.js`** - Generate drafts using Claude with Exit 163 voice prompt
- **`lib/articles.js`** - Main pipeline orchestration and review actions

### API Endpoints

- **`POST /api/article-pipeline`** - Run pipeline (called by Vercel cron daily at 6am)
  - Auth: `Authorization: Bearer <ADMIN_TOKEN>`
  - Body: `{ "dry_run": true/false, "steps": ["discovery", "verification", "writing"] }`
  - Returns: Execution results with counts and timing

- **`GET /api/article-review`** - Get pending drafts and recent articles
  - Auth: `Authorization: Bearer <ADMIN_TOKEN>`
  - Returns: `{ pending: [...], recent: [...], counts: {...} }`

- **`POST /api/article-review`** - Approve or reject a draft
  - Auth: `Authorization: Bearer <ADMIN_TOKEN>`
  - Body: `{ "action": "approve|reject", "draft_id": 123, "reviewed_by": "admin", "reason": "..." }`

### Review Interface

- **URL**: `https://www.exit163.com/article-review`
- **Auth**: Same `ADMIN_TOKEN` used for weekly text blast
- Token is stored in browser localStorage for convenience
- Clean, mobile-friendly UI showing:
  - Pending drafts with full content, sources, and confidence scores
  - Unconfirmed items highlighted
  - One-click approve/reject actions
  - Recently published articles

## Setup

### 1. Run the Migration

Connect to your Supabase project and run:

```bash
psql $DATABASE_URL < db/migrations/2026-11-15-article-pipeline.sql
```

Or paste the contents into the Supabase SQL Editor.

### 2. Seed Discovery Sources

```bash
node scripts/article-pipeline-test.js seed
```

This creates initial sources:
- NorthJersey.com Bergen County RSS
- Patch Ridgewood & Paramus
- TAPinto Ridgewood & Paramus
- Bergen Mama family events

Add more sources directly in the database or by editing `lib/discovery.js`.

### 3. Configure Environment Variables

The pipeline uses the existing `ANTHROPIC_API_KEY` and `ADMIN_TOKEN` from `.env.example`. No new variables needed.

**Cost management**: Pipeline defaults to `claude-haiku-5-5` (cheap) with `effort: low` to keep costs reasonable. Adjust in `lib/writer.js` if needed.

### 4. Test Locally (Dry Run)

```bash
node scripts/article-pipeline-test.js dry-run
```

This runs the full pipeline **without writing to the database**, showing what would happen:

```
Running article pipeline in DRY RUN mode...

=== PIPELINE RESULTS ===
Success: true
Total time: 12.3s

Discovery:
  Sources checked: 5
  Stories found: 23
  New stories: 18
  Duplicates: 5

Verification:
  Stories processed: 18
  Entities found: 12
  Entities verified: 8
  High confidence: 3

Writing:
  Stories processed: 8
  Drafts created: 6
  Drafts skipped: 2
  Errors: 0
```

### 5. Deploy to Vercel

The cron job is already configured in `vercel.json`:

```json
{
  "path": "/api/article-pipeline",
  "schedule": "0 6 * * *"
}
```

This runs daily at **6:00 AM UTC** (1am EST / 2am EDT).

**To enable it:**

1. Push this branch to GitHub
2. Vercel auto-deploys (or deploy manually)
3. The cron starts automatically (no action needed)

**To disable it** (for testing or pausing):
- Remove the cron block from `vercel.json` and redeploy
- Or let it run but don't approve drafts (they'll queue harmlessly)

### 6. Set the Admin Token in Vercel

1. Go to Vercel → Project → Settings → Environment Variables
2. Ensure `ADMIN_TOKEN` is set (same token used for weekly blast)
3. No other variables needed (uses existing `ANTHROPIC_API_KEY`)

### 7. Review Workflow

**Daily routine:**

1. Pipeline runs automatically at 6am
2. Joe visits `https://www.exit163.com/article-review` when convenient
3. Enters `ADMIN_TOKEN` (saved in browser after first login)
4. Reviews pending drafts:
   - Read the snippet and sources
   - Check confidence score (high/medium/low)
   - Note any unconfirmed items (opening dates, hours, etc.)
   - Click "Approve & Publish" or "Reject"
5. Approved articles → `published_articles` table
6. Rejected articles → marked rejected (reason logged)

**Newsletter/SMS integration:**

Approved articles are in `published_articles` with these fields:
- `headline`, `body` (the snippet)
- `town_slug`, `category` (for filtering)
- `entity_link`, `source_url` (for attribution)
- `published_at` (for recency)

Query them in newsletter build or MCP tools:

```sql
SELECT headline, body, entity_link, category, town_slug
FROM published_articles
WHERE published_at >= '2024-11-08'  -- this week
  AND category = 'food'
  AND town_slug = 'ridgewood'
ORDER BY published_at DESC
LIMIT 5
```

## Configuration

### Discovery Sources

Add/edit sources in the `discovery_sources` table:

```sql
INSERT INTO discovery_sources (name, url, source_type, towns, categories, check_interval, notes)
VALUES (
  'Source Name',
  'https://example.com/feed.xml',
  'rss',                          -- rss | html | api
  ARRAY['Ridgewood', 'Glen Rock'],
  ARRAY['food', 'community'],
  'daily',                         -- hourly | daily | weekly
  'Notes about this source'
);
```

**Current sources**: 5 RSS feeds (see `lib/discovery.js` seed function)

**To expand**: Add more TAPinto towns, Patch towns, local paper RSS feeds, venue calendars with RSS.

### Pipeline Limits

Edit in library files to control costs:

- **Discovery**: `maxStoriesPerSource: 20` in `lib/discovery.js` (per run, per source)
- **Verification**: `limit: 50` in `lib/articles.js` (stories processed per run)
- **Writing**: `limit: 20` in `lib/articles.js` (drafts written per run)

These are per-run caps. Increase cautiously to avoid API rate limits and costs.

### Voice Tuning

The writing prompt is in `lib/writer.js` (`WRITER_SYSTEM`). It follows Exit 163 brand rules:

- Weekend plans first (events, food, family, nightlife, sports)
- Specific about town and time
- Honest ("time not posted yet", "they don't say")
- No clickbait, no invented details
- Two sources required (flagged if missing)
- Clear attribution

Adjust the prompt if drafts aren't matching the voice.

## Monitoring

### Review UI Stats

The review interface shows:
- Pending drafts count
- Recent articles count
- Last 20 published

### Pipeline Run History

Query `article_pipeline_runs` for execution logs:

```sql
SELECT started_at, status, stories_discovered, entities_verified, drafts_created, error_message
FROM article_pipeline_runs
ORDER BY started_at DESC
LIMIT 10;
```

### Manual Trigger

Run the pipeline manually:

```bash
curl -X POST https://www.exit163.com/api/article-pipeline \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": false}'
```

Or with specific steps:

```bash
curl -X POST https://www.exit163.com/api/article-pipeline \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"steps": ["discovery"], "dry_run": false}'
```

## Troubleshooting

### No drafts appearing

1. Check if sources are enabled:
   ```sql
   SELECT name, enabled, last_checked, last_error FROM discovery_sources;
   ```

2. Check if discovery is finding stories:
   ```sql
   SELECT COUNT(*), status FROM discovered_stories GROUP BY status;
   ```

3. Check pipeline run logs:
   ```sql
   SELECT * FROM article_pipeline_runs ORDER BY started_at DESC LIMIT 5;
   ```

### Low-quality drafts

- Increase verification confidence threshold in `lib/verification.js`
- Filter out low-confidence entities before writing
- Tune the writer prompt in `lib/writer.js`
- Reject drafts and inspect `rejection_reason` patterns

### High API costs

- Use `claude-haiku-5-5` (cheapest, already default)
- Reduce `limit` in writing step (fewer drafts per run)
- Increase dry_run testing before enabling cron
- Monitor Claude API usage in Anthropic dashboard

### Sources failing

Check `last_error` in `discovery_sources`:

```sql
SELECT name, last_checked, last_error FROM discovery_sources WHERE last_error IS NOT NULL;
```

Common issues:
- RSS feed moved or broken (update URL)
- Site blocking User-Agent (add to `lib/discovery.js`)
- Rate limiting (reduce check frequency)

## Future Enhancements

**Possible next steps** (not implemented):

1. **Better verification**: Integrate Google Places API or Yelp API for business lookup
2. **Second source finder**: Automatically search for confirming sources
3. **Email digest**: Send Joe a daily email of pending drafts instead of requiring login
4. **Slack integration**: Post drafts to a Slack channel for approval
5. **More sources**: Add Facebook events scraper, Instagram scraper (requires auth)
6. **Category detection**: Auto-categorize stories (food, family, nightlife)
7. **Town extraction**: Better NLP for extracting town from story text
8. **Opening date tracking**: Track "coming soon" businesses and update when they open
9. **Auto-publish trusted sources**: Skip review for high-confidence, high-quality sources

## Design Decisions

**Why RSS feeds?**
- No API keys needed, no auth, no rate limits
- Local news outlets (Patch, TAPinto, NorthJersey) all have RSS
- Simple to parse, reliable format

**Why Claude Haiku?**
- Cheapest Claude model (~$0.25 per million input tokens)
- `effort: low` further reduces cost
- Still high quality for short-form content (150-word snippets)

**Why manual review?**
- Editorial voice is critical to Exit 163 brand
- AI can miss nuance (wrong town, unverified detail, not Bergen-relevant)
- Builds trust: readers know every item is human-approved
- Low volume (10-20 drafts/day) makes manual feasible

**Why not auto-publish?**
- Exit 163 is faceless but not faceless: Joe's judgment is the brand
- Errors (wrong info, bad links) would damage credibility
- "Two sources" rule requires human verification of linked sources

**Why store in Supabase?**
- Same database as events, venues, SMS users
- Easy to query for newsletter, MCP, SMS agent
- Persistent storage (RSS items are ephemeral)

## Cost Estimate

**API usage per day** (assuming 20 drafts):

- **Discovery**: Free (RSS feeds)
- **Verification**: Free (DuckDuckGo search fallback) or ~$5/month with Firecrawl (optional)
- **Entity Extraction**: 20 stories × 500 input + 100 output tokens = 10K input + 2K output
- **Draft Writing**: 20 drafts × 1,000 input + 200 output tokens = 20K input + 4K output

**Daily totals** (Claude Haiku 5-5 @ $0.25/M input, $1.25/M output):
- Input: 30,000 tokens × $0.25/M = **$0.0075/day**
- Output: 6,000 tokens × $1.25/M = **$0.0075/day**
- **Total: $0.015/day = ~$5.50/year** (Claude API only)

Add Firecrawl (~$5/month for better verification, optional) → **~$65/year total** with Firecrawl, or **~$6/year** without.

**Time per day**:
- Pipeline: ~30 seconds automated
- Joe's review: ~5 minutes (assuming 10-15 drafts)

## Questions for Joe

Before going live, confirm:

1. **Cron timing**: 6am UTC (1am EST) good? Or prefer 9am UTC (4am EST)?
2. **Review cadence**: Daily, or prefer batches 2-3x/week?
3. **Email notification**: Want an email when drafts are ready? (not built yet, easy to add)
4. **Auto-reject low confidence**: Reject confidence:low drafts automatically, or always show?
5. **Source priorities**: Any sources to add/remove from the seed list?

## Summary

The article pipeline is **ready to deploy**. It:

✅ Discovers stories from local RSS feeds  
✅ Verifies businesses and resolves towns  
✅ Writes original snippets in Exit 163 voice  
✅ Queues drafts for Joe's approval  
✅ Publishes approved articles to database  
✅ Integrates with existing infra (same API key, token, database)  
✅ Runs on Vercel cron (no external services)  
✅ Has dry-run mode for testing  
✅ Keeps costs low (~$1/year API usage)  
✅ Respects editorial rules (two sources, no invented details, honest about unknowns)

**To activate**: Run migration, seed sources, test dry-run, deploy. Joe reviews daily at `/article-review`.
