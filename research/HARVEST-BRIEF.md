# Exit 163 harvest brief (for harvest agents)

A source registry now exists in `research/sources/*.json` (see `research/SOURCES-BRIEF.md` for its
schema). **Your job is to visit the sources in one registry file and collect the real, dated,
upcoming events they list**, so the texting agent can recommend them. Today is Thursday Nov 12, 2026.
Window: **Nov 12, 2026 through Jan 3, 2027** (include anything further out only if it is a big
ticketed event people book ahead, e.g. New Year's Eve or a January concert).

Read `research/BRIEF.md` first: its rules (never invent, Bergen County only, `verified` only when the
source gives this season's date, times exactly as published) and its **output JSON format** (an object
with `events` and `places` arrays) apply to you unchanged. Additions for this harvest:

## What to collect
- Work through the registry's sources with `access: "open"` (and `js_heavy` ones if Firecrawl can
  render them), highest `yield` first. Skip `login_required` sources; do not log in to anything, do
  not use the user's browser, do not follow, join or post.
- One event object per dated occurrence for one-offs. For a standing weekly night (e.g. "DJ every
  Saturday"), write one object with `starts_on` = the next date, `ends_on` = the last date you can
  confirm or `"2027-01-03"`, and `recurrence_text` like "Every Saturday".
- Every event needs a `source_url` **you loaded in this run** that shows the date. A registry
  `sample_events` entry is a lead, not proof: reload its source before you use it. Facts taken from a
  search snippet only (not a loaded page) must be `verified: false` with "from a search snippet" in the
  description.
- **Put the people in the title or description**: the DJ, band, comedian, host or promoter by name,
  exactly as the source spells it. "DJ G Rock at The Roosevelt" beats "Saturday dance party".
- **Tags are how the agent finds things**, so be generous and consistent (lowercase). Use every one
  that truly applies:
  - what it is: `dj`, `dancing`, `dance party`, `live music`, `cover band`, `tribute`, `karaoke`,
    `trivia`, `comedy`, `open mic`, `brunch`, `day party`, `ladies night`, `singles`, `speed dating`,
    `line dancing`, `salsa`, `bachata`, `class`, `tasting`, `wine`, `beer`, `festival`, `market`,
    `5k`, `hike`, `ride`, `film`, `theater`, `art`, `workshop`, `game night`, `meetup`
  - music: `latin`, `reggaeton`, `hip hop`, `r&b`, `90s`, `2000s`, `80s`, `disco`, `freestyle`,
    `house`, `edm`, `caribbean`, `afrobeats`, `k-pop`, `country`, `rock`, `jazz`, `polish`
  - who: `21+`, `30+`, `40+`, `50+`, `all ages`, `kids`, `teens`, `seniors`, `lgbtq`, `date night`,
    `groups`, `beginner friendly`, `dog friendly`
  - when/cost: `late night`, `free`, `ticketed`, `thanksgiving eve`, `black friday`, `new years eve`,
    `holiday`
  Only tag an age group when the source says it or the event is plainly built for it.
- `category`: use `nightlife` for parties, DJ nights, bar events and singles events; `arts` for
  concerts, theater, comedy shows, film and art; `food` for tastings, dinners and classes about food
  and drink; `outdoors`, `sports`, `community`, `family`, `holiday`, `shopping` as in the brief.
- Add new always-there venues you discover to `places` (with `best_for` and tags like `dj`,
  `dancing`, `lounge`, `rooftop`, `hookah`, `karaoke rooms`) when the source confirms they are open.
- Skip anything explicit or adult-entertainment, anything outside Bergen County, and anything already past.

## Budget and conduct
- WebFetch and WebSearch first. Firecrawl CLI (`firecrawl scrape <url>`) only for pages they can't
  read: **at most 50 Firecrawl credits for your whole task**; only 2 Firecrawl jobs run at once across
  all agents, so on a concurrency error wait 20s and retry.
- Work in `/Users/noahajeo/Projects/Exit 163/site`. Write ONLY your own output file. Don't touch other
  files, don't commit, don't call any database, don't send anything anywhere.
- Validate before finishing: the file parses, and
  `node --env-file=.env.local scripts/import-research.js <your file> --dry` reports no problems you
  could fix (the `--dry` flag only validates; never run it without `--dry`).

## Your final message
Report: file path, number of events and places, how many are `verified: true`, the count by tag for
the 10 most common tags, the 10 best events for this weekend (Nov 13-15) and next (Nov 20-22) in one
line each, sources that failed to load, registry entries you found to be wrong or dead, and Firecrawl
credits used.
