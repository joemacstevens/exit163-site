# Exit 163 research brief (for research agents)

Exit 163 is a free local guide to **Bergen County, New Jersey** (70 towns). A texting agent answers
"what should I do this weekend?" from our database. Your job: find **real, sourced** things to do and
write them to a JSON file. Today is Monday Nov 9, 2026. Coverage window: **Nov 9, 2026 – Feb 28, 2027**.

## Tools
- Firecrawl CLI is installed and signed in: `firecrawl search "<query>" --limit 5`, `firecrawl scrape <url>`.
  Run `firecrawl --help` / `firecrawl search --help` for flags. Pages save under `.firecrawl/` (gitignored).
- **Credit budget: at most 200 Firecrawl credits for your whole task.** The account has ~1,000 total and is
  shared with 3 other agents. Prefer one good listing page (a venue's events calendar, a town's events page,
  a county parks calendar) over many single-event pages. Check `firecrawl --status` now and then.
- Only 2 Firecrawl jobs can run at once across all agents. If you get a rate-limit / concurrency error, wait 20s and retry.
- Work in /Users/noahajeo/Projects/Exit 163/site. Write ONLY your own output file. Don't touch other files,
  don't commit, don't call any database.

## Rules (non-negotiable)
1. **Never invent anything.** Every item needs a `source_url` you actually loaded that states the facts.
2. Only Bergen County, NJ towns (Allendale ... Wyckoff; use `"Bergen County"` for county-wide, e.g. county parks).
   Skip events outside Bergen even if close (Manhattan, Montclair, Hoboken, Rockland County).
3. `verified: true` only if the source explicitly gives this season's date (2026 or 2027). If you're
   inferring from last year, set `verified: false` and say so in `description`.
4. Times exactly as published ("7:30 PM", "10 AM - 2 PM"). Unknown = null, never guessed.
5. Skip: anything already past (before Nov 9, 2026), private events, fundraisers needing invitations, generic
   chain-store sales, political events, and anything adult/explicit.
6. Descriptions: 1-2 friendly, factual sentences in your own words (no copying), e.g. what makes it fun, who it's for.
7. Quality over quantity. 40 solid items beat 150 thin ones. Aim for spread across many towns.

## Output: JSON file, an object with two arrays
```json
{
  "events": [
    {
      "title": "Holiday Lights Drive-Thru",
      "town": "Paramus",                     // a Bergen town name, or "Bergen County"
      "location": "Van Saun County Park, 216 Forest Ave",
      "category": "family",                  // family | food | nightlife | arts | sports | holiday | outdoors | shopping | community | other
      "tags": ["kids", "free", "lights"],    // short lowercase words people might search
      "starts_on": "2026-12-04",             // YYYY-MM-DD or null if not announced
      "ends_on": "2026-12-31",               // last day for multi-day/recurring runs, else null
      "recurrence_text": "Fri-Sun evenings", // for runs/recurring, else null
      "time_text": "5 PM - 9 PM",
      "cost_text": "$20 per car",
      "description": "Drive through a mile of lights...",
      "source_url": "https://...",
      "verified": true
    }
  ],
  "places": [
    {
      "name": "Bounce Town",                 // a business or public place that's always there
      "town": "Fair Lawn",
      "address": "123 Main St",
      "category": "family",                  // food | family | nightlife | shopping | arts | outdoors | services
      "tags": ["trampoline", "indoor"],
      "best_for": ["kids", "rainy day"],     // kids | toddlers | teens | date night | groups | rainy day | dogs | free | budget | special occasion | brunch | live music | late night
      "price_text": "$$",                    // or "$25/hour", "Free"
      "hours_text": null,                    // only if the source states it
      "description": "One-sentence why-go.",
      "website": "https://...",
      "source_url": "https://...",
      "status": "open",                      // open | coming_soon
      "opened_on": null,                     // YYYY-MM-DD for new openings when known
      "verified": true                       // true = source confirms it's currently operating
    }
  ]
}
```
Validate your file parses (`python3 -c "import json;json.load(open('<file>'))"`) before finishing.

## Your final message
Report: file path, number of events and places, Firecrawl credits used, the best sources you found
(listing pages worth re-checking monthly), and gaps you couldn't fill.
