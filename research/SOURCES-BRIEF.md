# Exit 163 source-scouting brief (for research agents)

Exit 163 is a local guide to **Bergen County, New Jersey** (70 towns). A texting agent answers
"what should I do this weekend?" from our database. The database is only as good as the places we
look. Today is Thursday Nov 12, 2026.

**Your job is NOT to collect events. It is to find the sources we should re-check on a schedule**
so the database stays current: the pages, calendars, accounts, groups and feeds where Bergen County
events first show up. Think like a local who knows where to look, well past the newspapers
(NorthJersey.com, Patch, TAPinto are already known; list them only if a specific sub-page is useful).

Read `research/BRIEF.md` for background on the project and the list of what counts as Bergen County.
The existing research files in `research/*.json` show what we already cover; don't re-list a source
that only confirms what is there unless it has an events calendar worth re-checking.

## What makes a good source
- It publishes **dated, upcoming** things a person can go to, in Bergen County.
- It is **alive**: you saw at least one event dated after Nov 12, 2026, or a post from the last ~30 days.
- It is **specific**: the exact URL to re-check (the calendar page, the Eventbrite organizer page,
  the Instagram handle), not a home page.
- Prefer sources that produce many events (a promoter, a venue calendar, a DJ's gig list, a band's
  schedule, a ticketing search filtered to a town) over one-off event pages.

## How to work
- Use WebSearch and WebFetch first. Firecrawl CLI is installed (`firecrawl search "<q>" --limit 5`,
  `firecrawl scrape <url>`) for pages WebFetch can't read. **At most 60 Firecrawl credits for your whole
  task**; only 2 Firecrawl jobs run at once across all agents, so on a concurrency error wait 20s and retry.
- Facebook groups, Facebook pages and Instagram accounts matter a lot here. Find them through search
  engines and public pages only. **Do not log in to anything, do not use the user's browser, do not
  join, follow, like, message or post.** If a source can't be read without logging in, still list it,
  with `access: "login_required"` and whatever you could confirm from public snippets (name, member or
  follower count, what gets posted).
- Never invent a source, a handle, a URL or an event. Every `url` must be one you actually loaded or
  saw in a search result. If you could not load it, say so in `how_checked`.
- Work in `/Users/noahajeo/Projects/Exit 163/site`. Write ONLY your own output file. Don't touch other
  files, don't commit, don't call any database, don't send anything anywhere.

## Output: one JSON file, `research/sources/<your-file>.json`
```json
{
  "domain": "nightlife",
  "sources": [
    {
      "name": "DJ Example",
      "kind": "dj",                    // venue_calendar | promoter | dj | band | facebook_page | facebook_group | instagram | ticketing_search | ticketing_organizer | town_calendar | library | county | media_listing | aggregator | community_org | meetup | other
      "url": "https://...",            // the exact page to re-check
      "other_urls": ["https://instagram.com/..."],
      "platform": "instagram",         // web | facebook | instagram | eventbrite | posh | dice | bandsintown | meetup | tiktok | ...
      "towns": ["Hackensack", "Fort Lee"],   // Bergen towns it covers, or ["Bergen County"]
      "categories": ["nightlife"],     // family | food | nightlife | arts | sports | holiday | outdoors | shopping | community | other
      "event_types": ["Latin nights", "90s parties"],
      "audience": "30s-40s, 21+",      // who goes, as the source describes it; null if unknown
      "access": "open",                // open | login_required | js_heavy | blocked
      "how_checked": "webfetch",       // webfetch | firecrawl | search_snippet_only
      "cadence": "weekly",             // how often it's worth re-checking: daily | weekly | biweekly | monthly | seasonal
      "last_seen_activity": "2026-11-08",   // newest post or event date you saw, or null
      "sample_events": [               // up to 3 upcoming events that prove it is live (dated after Nov 12, 2026)
        {"title": "...", "date": "2026-11-21", "time": "9 PM", "venue": "...", "town": "...", "cost": null, "source_url": "https://..."}
      ],
      "yield": "high",                 // high | medium | low: how many Bergen events per month you'd expect
      "notes": "One or two sentences: why it matters, quirks, how to read it."
    }
  ],
  "search_recipes": ["site:eventbrite.com \"Hackensack, NJ\" party"],   // searches that reliably surface new events
  "gaps": ["What you looked for and could not find."]
}
```
Validate it parses (`python3 -c "import json;json.load(open('<file>'))"`) before finishing.
Aim for 40-80 solid sources, ranked best first, spread across many towns and audiences.

## Your final message
Report: file path, number of sources by kind, your top 10 with one line each, which need a logged-in
Facebook/Instagram session to read, Firecrawl credits used, and gaps.
