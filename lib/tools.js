// The Exit 163 tool set. One implementation, three front doors:
// the SMS buddy (lib/agent.js), the MCP server (api/mcp.js), and anything else later.
const { db, q } = require('./db');
const { TOWNS, BY_SLUG, resolveTown } = require('./towns');
const { todayNJ, addDays, thisWeekend, prettyDate } = require('./dates');

const EVENT_CATEGORIES = ['family', 'food', 'nightlife', 'arts', 'sports', 'holiday', 'outdoors', 'shopping', 'community', 'other'];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Who an event is for, from its category and tags. Only "good for kids" counts as a kids' pick:
// an "all ages" rock show at 8pm lets kids in but isn't made for them.
const KID_TAGS = ['kids', 'family', 'children', 'toddlers', 'teens', 'santa'];
const ADULT_TAGS = ['21+', 'bar', 'pub', 'happy hour', 'late night', 'brewery', 'wine'];
function audience(e) {
  const tags = (e.tags || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => ADULT_TAGS.includes(t))) return 'adults';
  if (e.category === 'family' || tags.some((t) => KID_TAGS.includes(t))) return 'good for kids';
  if (tags.includes('all ages')) return 'all ages allowed, not made for kids';
  if (e.category === 'nightlife') return 'adults';
  return 'not marked as a kids event';
}

function shapeEvent(e) {
  return {
    title: e.title,
    town: BY_SLUG.get(e.town_slug)?.name || e.town_slug,
    date: e.starts_on ? prettyDate(e.starts_on) + (e.ends_on && e.ends_on !== e.starts_on ? ` - ${prettyDate(e.ends_on)}` : '') : 'date not announced yet',
    date_iso: e.starts_on,
    ...(e.recurrence_text ? { when: e.recurrence_text } : {}),
    time: e.time_text || 'time not posted',
    where: e.location || null,
    cost: e.cost_text || null,
    about: e.description || null,
    category: e.category,
    tags: e.tags || [],
    audience: audience(e),
    confirmed_this_year: e.verified,
    source: e.source_url || null,
  };
}

async function logQuery(channel, { town, category, text }) {
  try { await q(db().from('queries').insert({ channel, town_slug: town || null, category: category || null, query_text: text ? String(text).slice(0, 500) : null })); }
  catch (e) { console.error('logQuery', e.message); }
}

async function searchEvents(args = {}, ctx = {}) {
  const channel = ctx.channel || 'unknown';
  const townSlug = args.town ? resolveTown(args.town) : null;
  if (args.town && !townSlug) return { error: `"${args.town}" isn't a Bergen County town I know. Use list_towns.` };
  const category = args.category && EVENT_CATEGORIES.includes(args.category) ? args.category : null;

  let start = YMD.test(args.start_date || '') ? args.start_date : null;
  let end = YMD.test(args.end_date || '') ? args.end_date : null;
  if (!start && !end) ({ start, end } = thisWeekend());
  if (!start) start = todayNJ();
  if (!end) end = addDays(start, 2);
  if (end < start) [start, end] = [end, start];

  let query = db().from('events')
    .select('title,town_slug,location,category,tags,starts_on,ends_on,recurrence_text,time_text,cost_text,description,source_url,verified')
    .eq('status', 'published')
    // Overlaps the window: starts on/before end and (ends or starts) on/after start.
    .lte('starts_on', end)
    .or(`ends_on.gte.${start},and(ends_on.is.null,starts_on.gte.${start})`)
    .order('verified', { ascending: false })
    .order('starts_on', { ascending: true })
    .limit(200);
  if (townSlug) query = query.in('town_slug', [townSlug, 'bergen-county']);
  if (category) query = query.eq('category', category);

  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
  const rows = (await q(query)).filter((e) => matchesKeyword(e, args.keyword))
    .filter((e) => !args.for_kids || audience(e) === 'good for kids').slice(0, limit);
  let unconfirmed = [];
  if (args.include_date_tba) {
    let tba = db().from('events').select('title,town_slug,location,category,tags,starts_on,ends_on,recurrence_text,time_text,cost_text,description,source_url,verified')
      .eq('status', 'published').is('starts_on', null).limit(200);
    if (townSlug) tba = tba.in('town_slug', [townSlug, 'bergen-county']);
    if (category) tba = tba.eq('category', category);
    unconfirmed = (await q(tba)).filter((e) => matchesKeyword(e, args.keyword)).slice(0, 10).map(shapeEvent);
  }

  logQuery(channel, { town: townSlug, category, text: args.keyword || ctx.userText });

  return {
    window: { from: start, to: end },
    town: townSlug ? BY_SLUG.get(townSlug).name : 'all of Bergen County',
    count: rows.length,
    events: rows.map(shapeEvent),
    ...(unconfirmed.length ? { date_not_announced: unconfirmed } : {}),
    note: rows.length ? undefined : 'Nothing in the Exit 163 database for that window yet. Say so plainly; do not invent events.',
  };
}

// Every word of the keyword must appear in the title, description, location or tags.
function matchesKeyword(e, keyword) {
  if (!keyword) return true;
  const hay = [e.title, e.description, e.location, ...(e.tags || [])].join(' ').toLowerCase();
  return String(keyword).toLowerCase().split(/\s+/).filter(Boolean)
    .every((w) => hay.includes(w.replace(/s$/, '')));
}

const PLACE_COLS = 'name,town_slug,address,category,tags,best_for,price_text,hours_text,description,website,source_url,verified,status,opened_on';

function shapePlace(p) {
  return {
    name: p.name,
    town: BY_SLUG.get(p.town_slug)?.name || p.town_slug,
    address: p.address || null,
    category: p.category,
    good_for: p.best_for,
    price: p.price_text || null,
    hours: p.hours_text || null,
    about: p.description || null,
    ...(p.status === 'coming_soon' ? { status: 'coming soon' } : {}),
    ...(p.opened_on ? { opened: prettyDate(p.opened_on) } : {}),
    link: p.website || p.source_url || null,
  };
}

async function searchPlaces(args = {}, ctx = {}) {
  const channel = ctx.channel || 'unknown';
  const townSlug = args.town ? resolveTown(args.town) : null;
  if (args.town && !townSlug) return { error: `"${args.town}" isn't a Bergen County town I know. Use list_towns.` };
  let query = db().from('venues').select(PLACE_COLS).neq('status', 'closed').limit(300);
  if (townSlug && townSlug !== 'bergen-county') query = query.in('town_slug', [townSlug, 'bergen-county']);
  if (args.category) query = query.eq('category', args.category);
  if (args.new_only) query = query.not('opened_on', 'is', null).order('opened_on', { ascending: false });
  let rows = await q(query);
  if (args.good_for) rows = rows.filter((p) => (p.best_for || []).some((b) => b.toLowerCase().includes(String(args.good_for).toLowerCase())));
  rows = rows.filter((p) => matchesKeyword({ ...p, title: p.name }, args.keyword));
  rows.sort((a, b) => Number(b.verified) - Number(a.verified));
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 15);
  logQuery(channel, { town: townSlug, category: args.category, text: [args.keyword, args.good_for].filter(Boolean).join(' ') || ctx.userText });
  return {
    town: townSlug ? BY_SLUG.get(townSlug).name : 'all of Bergen County',
    count: Math.min(rows.length, limit),
    places: rows.slice(0, limit).map(shapePlace),
    note: rows.length ? undefined : 'No matching places in the Exit 163 database yet. Say so; do not invent places.',
  };
}

async function listTowns() {
  return { county: 'Bergen County, NJ', towns: TOWNS.filter((t) => t.slug !== 'bergen-county').map((t) => t.name) };
}

// JSON-schema definitions shared by Claude tool use and MCP tools/list.
const TOOL_DEFS = [
  {
    name: 'search_events',
    description: 'Search verified things to do in Bergen County, NJ from the Exit 163 database. Defaults to this weekend (Fri-Sun, NJ time) when no dates are given. Results include the source link, whether the date is confirmed for this year, and an audience field ("good for kids", "all ages allowed, not made for kids", "adults", or "not marked as a kids event"); only call something kid-friendly when it says "good for kids".',
    input_schema: {
      type: 'object',
      properties: {
        town: { type: 'string', description: 'Bergen County town, e.g. "Ridgewood". Omit for the whole county. County-wide events are always included.' },
        start_date: { type: 'string', description: 'YYYY-MM-DD (NJ time). Omit for this weekend.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        category: { type: 'string', enum: EVENT_CATEGORIES },
        keyword: { type: 'string', description: 'Free text such as "tree lighting", "menorah", "santa", "market".' },
        include_date_tba: { type: 'boolean', description: 'Also return known events whose date is not announced yet.' },
        for_kids: { type: 'boolean', description: 'Only events marked as good for kids (family category or tagged kids/family/toddlers/teens/santa). Use when they are going with kids.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
    run: searchEvents,
  },
  {
    name: 'search_places',
    description: 'Search always-there places in Bergen County, NJ from the Exit 163 database: restaurants, cafes, bars, live music, indoor play, parks, museums, farms, rinks. Use for "where should we eat", "rainy day with kids", "date night", "new restaurants".',
    input_schema: {
      type: 'object',
      properties: {
        town: { type: 'string', description: 'Bergen County town. Omit for the whole county.' },
        category: { type: 'string', enum: ['food', 'family', 'nightlife', 'shopping', 'arts', 'outdoors', 'services'] },
        good_for: { type: 'string', description: 'e.g. kids, toddlers, teens, date night, rainy day, brunch, groups, dogs, free, budget, live music, late night, special occasion' },
        keyword: { type: 'string', description: 'e.g. pizza, korean, trampoline, coffee, brewery, ice skating' },
        new_only: { type: 'boolean', description: 'Only recently opened or coming-soon places.' },
        limit: { type: 'integer', minimum: 1, maximum: 15 },
      },
      additionalProperties: false,
    },
    run: searchPlaces,
  },
  {
    name: 'list_towns',
    description: 'List the 70 Bergen County towns Exit 163 covers.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: listTowns,
  },
];

module.exports = { TOOL_DEFS, searchEvents, searchPlaces, listTowns, logQuery, EVENT_CATEGORIES };
