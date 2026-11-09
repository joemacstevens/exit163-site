// Load towns + the 2026 holiday tracker into Supabase. Safe to re-run (upserts).
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.js
const path = require('path');
const { db, q } = require('../lib/db');
const { TOWNS, resolveTown } = require('../lib/towns');

const TYPE_TAGS = { tree: ['tree lighting'], menorah: ['menorah', 'hanukkah'], santa: ['santa', 'kids'], market: ['market', 'shopping'], other: [] };

(async () => {
  await q(db().from('towns').upsert(TOWNS.map((t) => ({ slug: t.slug, name: t.name })), { onConflict: 'slug' }));
  console.log(`towns: ${TOWNS.length}`);

  const holidays = require(path.join(__dirname, '..', 'holidays-2026.json'));
  const rows = [];
  for (const h of holidays) {
    const town = resolveTown(h.town);
    if (!town) { console.warn('skip, unknown town:', h.town); continue; }
    const tags = ['holiday', ...(TYPE_TAGS[h.type] || [])];
    if (/free/i.test(h.cost || '')) tags.push('free');
    rows.push({
      title: h.event,
      town_slug: town,
      location: h.location || null,
      category: 'holiday',
      tags,
      starts_on: h.date || null,
      time_text: h.time || null,
      cost_text: h.cost || null,
      description: h.notes || null,
      source_url: h.source_url || null,
      verified: Boolean(h.verified_2026),
      origin: 'research',
    });
  }
  // Undated rows can't use the (title, town, starts_on) unique key (NULLs never conflict), so
  // clear research holiday rows first and re-insert. Venue/reader-submitted rows are untouched.
  await q(db().from('events').delete().eq('origin', 'research').eq('category', 'holiday'));
  await q(db().from('events').insert(rows));
  console.log(`events: ${rows.length} (${rows.filter((r) => r.starts_on).length} dated, ${rows.filter((r) => r.verified).length} confirmed)`);
})().catch((e) => { console.error(e); process.exit(1); });
