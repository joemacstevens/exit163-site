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

# Support both known data schemas.
cat = data.get("categories", {})
stories = []

if isinstance(cat, dict) and "restaurant_openings_closings" in cat:
    pickers = [
        ("🚔 Crime", cat.get("local_news_crime", []), 0),
        ("🍕 Food", cat.get("restaurant_openings_closings", []), 0),
        ("📅 Events", cat.get("weekend_events", []), 0),
        ("🏠 Real Estate", cat.get("real_estate_transactions", []), 0),
    ]
    for label, arr, idx in pickers:
        if arr and len(arr) > idx:
            x = arr[idx]
            stories.append({
                "pill": label,
                "title": x.get("title", "Untitled"),
                "summary": x.get("summary", ""),
                "source": x.get("source", "Source"),
                "url": x.get("url", "#"),
            })
elif isinstance(data.get("items"), list):
    # fallback schema from scrape-bergen-news.sh
    mapping = {
        "crime": "🚔 Crime",
        "food": "🍕 Food",
        "events": "📅 Events",
        "real_estate": "🏠 Real Estate",
        "sports": "🏈 Sports",
        "business": "💼 Business",
    }
    seen = set()
    for item in data["items"]:
        c = item.get("category")
        if c in mapping and c not in seen:
            seen.add(c)
            stories.append({
                "pill": mapping[c],
                "title": item.get("title", "Untitled"),
                "summary": item.get("description", ""),
                "source": item.get("source", "Source"),
                "url": item.get("url", "#"),
            })
        if len(stories) >= 4:
            break

if not stories:
    raise SystemExit("No stories available to build daily section")

# Optional place enrichment from known field
place_lines = []
for p in data.get("restaurant_place_details", [])[:1]:
    address = p.get("address", "")
    name = p.get("name", "")
    if address and name:
        q = (name + " " + address).replace(" ", "+")
        place_lines.append(f"{name}: {address} • <a href=\"https://maps.google.com/?q={q}\" target=\"_blank\" rel=\"noopener\">Map</a>")

date_label = datetime.strptime(data.get("date"), "%Y-%m-%d").strftime("%A, %B %-d, %Y")

cards_html = []
for i, s in enumerate(stories[:4]):
    cards_html.append(f'''      <article class="story-card">
        <span class="story-pill">{escape(s["pill"])}</span>
        <h3>{escape(s["title"])}</h3>
        <p>{escape(s["summary"][:260])}</p>
        {'<p class="story-meta">'+place_lines[0]+'</p>' if i == 1 and place_lines else ''}
        <a href="{escape(s['url'])}" target="_blank" rel="noopener">Source: {escape(s['source'])} →</a>
      </article>''')

section = f'''<!-- TODAY_START -->
<section class="today">
  <div class="today-inner">
    <h2>What's Happening Today</h2>
    <p class="today-date">{escape(date_label)}</p>

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

with open(INDEX_FILE, "w", encoding="utf-8") as f:
    f.write(html)

print("Updated daily section in index.html")
PY

cd "$SITE_DIR"
git add index.html update-landing-page.sh
if ! git diff --cached --quiet; then
  git commit -m "Add daily Bergen County section and updater script"
  git push
  echo "Pushed changes."
else
  echo "No changes to commit."
fi
