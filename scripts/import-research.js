// Import research JSON files (see research/BRIEF.md) into Supabase.
//   node --env-file=.env.local scripts/import-research.js research/events-nov-dec.json [more files...]
//   add --dry to only validate
// Events dedupe on (title, town, starts_on); places upsert on (name, town).
const fs = require('fs');
const path = require('path');
const { db, q } = require('../lib/db');
const { resolveTown } = require('../lib/towns');

const EVENT_CATS = new Set(['family', 'food', 'nightlife', 'arts', 'sports', 'holiday', 'outdoors', 'shopping', 'community', 'other']);
const PLACE_CATS = new Set(['food', 'family', 'nightlife', 'shopping', 'arts', 'outdoors', 'services']);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TODAY = new Date().toISOString().slice(0, 10);

const str = (v, n = 500) => (v == null || v === '' ? null : String(v).trim().slice(0, n));
const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 12) : []);
const date = (v) => (YMD.test(String(v || '')) ? String(v) : null);
const url = (v) => (/^https?:\/\//.test(String(v || '')) ? String(v).slice(0, 600) : null);

function cleanEvent(e, batch) {
  const town = resolveTown(e.town);
  const problems = [];
  if (!str(e.title)) problems.push('no title');
  if (!town) problems.push(`unknown town "${e.town}"`);
  if (!url(e.source_url)) problems.push('no source_url');
  const starts = date(e.starts_on);
  const ends = date(e.ends_on);
  if ((ends || starts) && (ends || starts) < TODAY) problems.push('already over');
  if (problems.length) return { problems };
  return {
    row: {
      title: str(e.title, 200), town_slug: town, location: str(e.location, 300),
      category: EVENT_CATS.has(e.category) ? e.category : 'other', tags: arr(e.tags),
      starts_on: starts, ends_on: ends && ends !== starts ? ends : null, recurrence_text: str(e.recurrence_text, 120),
      time_text: str(e.time_text, 120), cost_text: str(e.cost_text, 120), description: str(e.description, 600),
      source_url: url(e.source_url), verified: e.verified === true, origin: 'research', research_batch: batch,
    },
  };
}

function cleanPlace(p, batch) {
  const town = resolveTown(p.town);
  const problems = [];
  if (!str(p.name)) problems.push('no name');
  if (!town) problems.push(`bad town "${p.town}"`);
  if (!url(p.source_url) && !url(p.website)) problems.push('no source');
  if (problems.length) return { problems };
  return {
    row: {
      name: str(p.name, 150), town_slug: town, address: str(p.address, 200),
      category: PLACE_CATS.has(p.category) ? p.category : 'family', tags: arr(p.tags), best_for: arr(p.best_for),
      price_text: str(p.price_text, 40), hours_text: str(p.hours_text, 200), description: str(p.description, 500),
      website: url(p.website), source_url: url(p.source_url) || url(p.website), verified: p.verified === true,
      status: p.status === 'coming_soon' ? 'coming_soon' : 'open', opened_on: date(p.opened_on), origin: 'research',
      updated_at: new Date().toISOString(),
    },
  };
}

// lib/tools.js reuses the two cleaners for its test-only HARVEST_OVERLAY, so only import when run directly.
module.exports = { cleanEvent, cleanPlace };

if (require.main === module) (async () => {
  const dry = process.argv.includes('--dry');
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const file of files) {
    const batch = path.basename(file, '.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ev = (data.events || []).map((e) => cleanEvent(e, batch));
    const pl = (data.places || []).map((p) => cleanPlace(p, batch));
    const bad = [...ev, ...pl].filter((x) => x.problems);
    const events = ev.filter((x) => x.row).map((x) => x.row);
    // dedupe places within file by name+town
    const seen = new Set();
    const places = pl.filter((x) => x.row).map((x) => x.row).filter((p) => {
      const k = `${p.name.toLowerCase()}|${p.town_slug}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });

    console.log(`${batch}: ${events.length} events, ${places.length} places ok; ${bad.length} rejected`);
    for (const b of bad.slice(0, 15)) console.log('   reject:', b.problems.join('; '));
    if (dry) continue;

    // Re-running a batch replaces it (dated events dedupe on the unique key too).
    await q(db().from('events').delete().eq('research_batch', batch));
    let added = 0;
    for (const row of events) {
      const { error } = await db().from('events').insert(row);
      if (!error) added++;
      else if (!/duplicate key/.test(error.message)) console.log('   event error:', row.title, error.message);
    }
    if (places.length) await q(db().from('venues').upsert(places, { onConflict: 'name,town_slug' }));
    console.log(`   imported ${added} events (others were duplicates), ${places.length} places`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
