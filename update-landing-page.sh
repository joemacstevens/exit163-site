#!/usr/bin/env bash
set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SITE_DIR/.." && pwd)"
BERGEN_DIR="$WORKSPACE_DIR/bergen-newsletter"
DATA_DIR="$BERGEN_DIR/data"
TODAY="${1:-$(date +%F)}"
DATA_FILE="$DATA_DIR/$TODAY.json"
INDEX_FILE="$SITE_DIR/index.html"

if [[ ! -f "$DATA_FILE" ]]; then
  echo "No data file for $TODAY. Running bergen scraper..."
  (cd "$BERGEN_DIR" && ./scrape-bergen-news.sh)
fi

if [[ ! -f "$DATA_FILE" ]]; then
  echo "ERROR: missing data file after scrape: $DATA_FILE" >&2
  exit 1
fi

python3 - "$DATA_FILE" "$INDEX_FILE" <<'PY'
import json, sys, re
from datetime import datetime
from html import escape

DATA_FILE = sys.argv[1]
INDEX_FILE = sys.argv[2]

with open(DATA_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

LISTICLE_PATTERNS = [
    r"\b\d+\s+(best|things|places|spots|restaurants|events|festivals)\b",
    r"\broundup\b",
    r"\bmega[-\s]?guide\b",
    r"\bevents?\s+guide\b",
    r"\bfairs?\s+and\s+festivals?\b",
    r"\bthis\s+week\b",
    r"\bthis\s+month\b",
    r"\bfebruary\s+\d{4}\b",
    r"\btop\s+\d+\b",
    r"\bguide\s+to\b",
    r"\bshould\s+know\s+about\b",
]

def is_listicle(title: str, summary: str) -> bool:
    t = f"{title} {summary}".lower()
    return any(re.search(p, t) for p in LISTICLE_PATTERNS)

def clean_summary(text: str, max_len=220):
    txt = (text or "").strip()
    if len(txt) <= max_len:
        return txt
    return txt[:max_len].rsplit(" ", 1)[0] + "…"

CRIME_WEATHER_PATTERNS = [
    r"\bpolice\b", r"\barrest\b", r"\bcrime\b", r"\bshooting\b", r"\bpursuit\b",
    r"\bcocaine\b", r"\bweather\b", r"\bsnow\b", r"\bicy\b", r"\bstorm\b"
]

def is_crime_or_weather(title: str, summary: str) -> bool:
    t = f"{title} {summary}".lower()
    return any(re.search(p, t) for p in CRIME_WEATHER_PATTERNS)

def is_fun_chaos(title: str, summary: str) -> bool:
    t = f"{title} {summary}".lower()
    # keep chaos quirky, not hard crime/weather
    quirky = ["weird", "odd", "viral", "bizarre", "chaos", "wtf", "wild", "funny"]
    return any(k in t for k in quirky) and not is_crime_or_weather(title, summary)

# Build candidate pool from fallback schema preferred
items = data.get("items", []) if isinstance(data.get("items"), list) else []

# If old schema appears, transform minimally
if not items and isinstance(data.get("categories"), dict):
    cat = data["categories"]
    for c, arr in {
        "food": cat.get("restaurant_openings_closings", []),
        "events": cat.get("weekend_events", []),
        "sports": cat.get("sports", []) or cat.get("high_school_sports_scores", []),
        "oddity": cat.get("local_news_crime", []),
    }.items():
        for x in arr or []:
            items.append({
                "category": c,
                "title": x.get("title", "Untitled"),
                "description": x.get("summary", ""),
                "source": x.get("source", "Source"),
                "url": x.get("url", "#"),
                "place_details": {},
            })

if not items:
    raise SystemExit("No stories available to build daily section")

# Filter out listicles/roundups (strict; do not fail-open)
filtered = [i for i in items if not is_listicle(i.get("title", ""), i.get("description", ""))]

# Priority pillars: Food, Sports, Events, Jersey Chaos
pillars = [
    ("food", "🍕 Food & Drink"),
    ("sports", "🏈 Sports"),
    ("events", "📅 Event"),
    ("oddity", "🌀 Jersey Chaos"),
]

cards = []
used_urls = set()
for cat_key, pill in pillars:
    candidates = [x for x in filtered if x.get("category") == cat_key and x.get("url") not in used_urls]

    # Keep daily feed anchored to food/sports/events; avoid crime/weather takeover
    if cat_key in ("food", "sports", "events"):
        candidates = [x for x in candidates if not is_crime_or_weather(x.get("title", ""), x.get("description", ""))]

    # Jersey Chaos should be quirky/funny; if none, we'll skip it
    if cat_key == "oddity":
        candidates = [x for x in candidates if is_fun_chaos(x.get("title", ""), x.get("description", ""))]

    # If no clean food story, synthesize a local food pick from goplaces details
    if cat_key == "food" and not candidates:
        places = data.get("goplaces_restaurant_details", [])
        if places:
            p = places[0]
            maps = f"https://maps.google.com/?q={str(p.get('address','')).replace(' ', '+')}"
            cards.append({
                "pill": "🍕 Food & Drink",
                "title": f"{p.get('name','Local Food Pick')} ({p.get('rating','?')}★)",
                "summary": "Fresh local pick for today — hand-selected by Exit 163.",
                "source": "Exit 163 Curated Pick",
                "url": maps,
                "meta": f"{p.get('address','')} • <a href=\"{maps}\" target=\"_blank\" rel=\"noopener\">Map</a>",
            })
        continue

    if not candidates:
        continue
    pick = candidates[0]
    used_urls.add(pick.get("url"))

    pd = pick.get("place_details") or {}
    place_line = ""
    if pd.get("address"):
        q = (pd.get("address") or "").replace(" ", "+")
        map_url = pd.get("maps_link") or f"https://maps.google.com/?q={q}"
        phone = pd.get("phone")
        bits = [pd.get("address")]
        if phone:
            bits.append(phone)
        bits.append(f'<a href="{escape(map_url)}" target="_blank" rel="noopener">Map</a>')
        place_line = " • ".join(bits)

    cards.append({
        "pill": pill,
        "title": pick.get("title", "Untitled"),
        "summary": clean_summary(pick.get("description", "")),
        "source": pick.get("source", "Source"),
        "url": pick.get("url", "#"),
        "meta": place_line,
    })

# If no event card made, synthesize from municipal updates when available
if not any(c.get('pill') == '📅 Event' for c in cards):
    mus = data.get('municipal_updates', [])
    if mus:
        m = mus[0]
        cards.append({
            "pill": "📅 Event",
            "title": m.get('title', 'Local Community Update'),
            "summary": clean_summary(m.get('summary', 'Local municipal update relevant for today.')),
            "source": m.get('source', 'Municipal Source'),
            "url": m.get('url', '#'),
            "meta": "",
        })

# If still light, add one more curated food/drink pick
if len(cards) < 3:
    places = data.get("goplaces_restaurant_details", [])
    if len(places) > 1:
        p = places[1]
        maps = f"https://maps.google.com/?q={str(p.get('address','')).replace(' ', '+')}"
        cards.append({
            "pill": "🍸 Drink / Food Pick",
            "title": f"{p.get('name','Local Drink/Food Pick')} ({p.get('rating','?')}★)",
            "summary": "Another hand-picked stop if you're getting off this exit today.",
            "source": "Exit 163 Curated Pick",
            "url": maps,
            "meta": f"{p.get('address','')} • <a href=\"{maps}\" target=\"_blank\" rel=\"noopener\">Map</a>",
        })

# If any pillar missing, fill from clean non-crime/weather stories only
if len(cards) < 4:
    for x in filtered:
        u = x.get("url")
        if u in used_urls:
            continue
        if is_crime_or_weather(x.get("title", ""), x.get("description", "")):
            continue
        used_urls.add(u)
        cards.append({
            "pill": "📍 Local Pick",
            "title": x.get("title", "Untitled"),
            "summary": clean_summary(x.get("description", "")),
            "source": x.get("source", "Source"),
            "url": u,
            "meta": "",
        })
        if len(cards) >= 4:
            break

if not cards:
    raise SystemExit("No cards after filtering")

date_label = datetime.strptime(data.get("date"), "%Y-%m-%d").strftime("%A, %B %-d, %Y")

cards_html = []
for s in cards[:4]:
    cards_html.append(f'''      <article class="story-card">
        <span class="story-pill">{escape(s["pill"])}</span>
        <h3>{escape(s["title"])}</h3>
        <p>{escape(s["summary"])}</p>
        {('<p class="story-meta">'+s['meta']+'</p>') if s.get('meta') else ''}
        <a href="{escape(s['url'])}" target="_blank" rel="noopener">Source: {escape(s['source'])} →</a>
      </article>''')

lead = "If you’re getting off this exit today: one place to eat, one game to care about, one thing to do, and one wild Jersey curveball."

section = f'''<!-- TODAY_START -->
<section class="today">
  <div class="today-inner">
    <h2>What's Happening Today</h2>
    <p class="today-date">{escape(date_label)}</p>
    <p class="today-lead">{escape(lead)}</p>

    <div class="today-grid">
{chr(10).join(cards_html)}
    </div>

    <p class="today-cta">Get the full weekly roundup — subscribe free 👆</p>
  </div>
</section>
<!-- TODAY_END -->'''

with open(INDEX_FILE, "r", encoding="utf-8") as f:
    html = f.read()

if "<!-- TODAY_START -->" in html and "<!-- TODAY_END -->" in html:
    html = re.sub(r"<!-- TODAY_START -->.*?<!-- TODAY_END -->", section, html, flags=re.S)
else:
    html = html.replace("</section>\n\n<div class=\"lane-stripe\"></div>", f"</section>\n\n{section}\n\n<div class=\"lane-stripe\"></div>", 1)

# Ensure basic style for lead line exists
if ".today-lead" not in html:
    html = html.replace(
        ".today-date { color: #5f7f71; font-weight: 700; margin-top: 4px; }",
        ".today-date { color: #5f7f71; font-weight: 700; margin-top: 4px; }\n    .today-lead { margin-top: 10px; color: #33443d; font-weight: 500; }"
    )

with open(INDEX_FILE, "w", encoding="utf-8") as f:
    f.write(html)

print("Updated daily section in index.html (pillar-first + anti-listicle)")
PY

cd "$SITE_DIR"
git add index.html update-landing-page.sh
if ! git diff --cached --quiet; then
  git commit -m "Shift daily section to pillar-first editorial voice; filter listicles"
  git push
  echo "Pushed changes."
else
  echo "No changes to commit."
fi
