// Read-only lookup for graders: what did the Exit 163 database actually hold?
//   node --env-file=.env.local scripts/eval-lookup.js salsa latin "don coqui"
// Prints upcoming events and places where ANY of the words appears (title/name, description, location, tags, town).
// Reads every row (the API returns at most 1,000 per request, so it pages), uses today's date in
// New Jersey, and prints up to 80 matches per table with a count of the rest.
const { db, q } = require('../lib/db');
const { todayNJ } = require('../lib/dates');
const words = process.argv.slice(2).map((w) => w.toLowerCase());
if (!words.length) { console.error('usage: eval-lookup.js <word> [more words]'); process.exit(1); }
const today = todayNJ();
const SHOW = 80;
const PAGE = 1000;
const hit = (s) => words.some((w) => s.includes(w));

// Every row of a table, 1,000 at a time, in a stable order.
async function all(table, cols, build = (x) => x) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await q(build(db().from(table).select(cols)).order('id').range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

(async () => {
  const ev = await all('events', 'title,town_slug,location,category,tags,starts_on,ends_on,recurrence_text,time_text,cost_text,description,source_url,verified', (x) => x.eq('status', 'published'));
  const pl = await all('venues', 'name,town_slug,address,category,tags,best_for,price_text,hours_text,description,website,status');
  const E = ev.filter((e) => (e.ends_on || e.starts_on || '9999') >= today).filter((e) => hit([e.title, e.description, e.location, e.town_slug, e.category, ...(e.tags || [])].join(' ').toLowerCase()));
  const P = pl.filter((p) => hit([p.name, p.description, p.address, p.town_slug, p.category, ...(p.tags || []), ...(p.best_for || [])].join(' ').toLowerCase()));
  console.log(`As of ${today} (NJ): ${ev.length} published events and ${pl.length} places read.`);
  console.log(`EVENTS (${E.length})`);
  for (const e of E.slice(0, SHOW)) console.log(`- ${e.title} | ${e.town_slug} | ${e.starts_on || 'TBA'}${e.ends_on ? '..' + e.ends_on : ''} ${e.recurrence_text || ''} | ${e.time_text || 'no time'} | ${e.cost_text || ''} | ${e.category} [${(e.tags || []).join(',')}] | ${(e.description || '').slice(0, 160)}`);
  if (E.length > SHOW) console.log(`... ${E.length - SHOW} more events not shown; add a narrower word.`);
  console.log(`\nPLACES (${P.length})`);
  for (const p of P.slice(0, SHOW)) console.log(`- ${p.name} | ${p.town_slug} | ${p.category} [${(p.tags || []).join(',')}] good for [${(p.best_for || []).join(',')}] | ${p.hours_text || ''} | ${(p.description || '').slice(0, 160)}`);
  if (P.length > SHOW) console.log(`... ${P.length - SHOW} more places not shown; add a narrower word.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
