// The Exit 163 tool set. One implementation, three front doors:
// the SMS buddy (lib/agent.js), the MCP server (api/mcp.js), and anything else later.
const fs = require('fs');
const path = require('path');
const { db, q } = require('./db');
const { TOWNS, BY_SLUG, resolveTown, resolveTowns, milesBetween, driveMinutes } = require('./towns');
const { todayNJ, nowNJ, addDays, weekday, thisWeekend, prettyDate, daysBetween } = require('./dates');
const S = require('./search');

const EVENT_CATEGORIES = ['family', 'food', 'nightlife', 'arts', 'sports', 'holiday', 'outdoors', 'shopping', 'community', 'other'];
const PLACE_CATEGORIES = ['food', 'family', 'nightlife', 'shopping', 'arts', 'outdoors', 'services'];
const SPONSOR_CATEGORIES = ['food', 'family', 'nightlife', 'shopping', 'services'];

// Which sponsor slot an event category belongs to.
const SPONSOR_SLOT = {
  family: 'family', holiday: 'family', outdoors: 'family', sports: 'family', community: 'family',
  food: 'food', nightlife: 'nightlife', arts: 'nightlife', shopping: 'shopping',
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Who an event is for, from its category and tags. Only "good for kids" counts as a kids' pick:
// an "all ages" rock show at 8pm lets kids in but isn't made for them.
const KID_TAGS = ['kids', 'family', 'children', 'toddlers', 'teens', 'santa', 'story time'];
const ADULT_TAGS = ['21+', '30+', '40+', '50+', 'bar', 'pub', 'happy hour', 'late night', 'brewery', 'wine', 'singles', 'speed dating'];
function audience(e) {
  const tags = (e.tags || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => ADULT_TAGS.includes(t))) return 'adults';
  if (e.category === 'family' || tags.some((t) => KID_TAGS.includes(t))) return 'good for kids';
  if (tags.includes('all ages')) return 'all ages allowed, not made for kids';
  if (e.category === 'nightlife') return 'adults';
  return 'not marked as a kids event';
}

// Standing weekly bar nights. Real, but rarely what someone means by "what's going on Saturday",
// so they rank below one-off events unless the person asked for them.
const FILLER_TAGS = ['happy hour', 'trivia', 'bingo', 'music bingo', 'karaoke', 'open mic', 'industry night', 'darts'];
const FILLER_KEYS = new Set(FILLER_TAGS.map((t) => S.words(t).join(' ')));

// Data -----------------------------------------------------------------------

const EVENT_COLS = 'title,town_slug,location,category,tags,starts_on,ends_on,recurrence_text,time_text,cost_text,description,source_url,verified';
const PLACE_COLS = 'name,town_slug,address,category,tags,best_for,price_text,hours_text,description,website,source_url,verified,status,opened_on';
const CACHE_MS = 60 * 1000;
const PAST_DAYS = 7;       // how far back the shared snapshot reaches
const PAGE = 1000;         // PostgREST returns at most 1000 rows per request

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await q(build().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function queryEvents(floor) {
  return fetchAll(() => db().from('events').select(EVENT_COLS).eq('status', 'published')
    .or(`starts_on.is.null,starts_on.gte.${floor},ends_on.gte.${floor}`).order('id'));
}

// TEST ONLY. HARVEST_OVERLAY is a comma-separated list of research JSON files (research/BRIEF.md
// format). When set, their events and places are merged over the database rows as if they had been
// imported, so a test run can see new research without anything being written to the live database.
// It is never set in production; when unset this returns null and nothing below changes.
let overlayRows; // parsed once per process
function overlay() {
  if (overlayRows !== undefined) return overlayRows;
  const list = String(process.env.HARVEST_OVERLAY || '').split(',').map((f) => f.trim()).filter(Boolean);
  if (!list.length) return (overlayRows = null);
  const { cleanEvent, cleanPlace } = require('../scripts/import-research.js');
  const events = [];
  const places = [];
  for (const file of list) {
    const batch = path.basename(file, '.json');
    const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    for (const e of data.events || []) {
      if (/DO NOT IMPORT/i.test(e.description || '')) continue;
      const { row } = cleanEvent(e, batch);
      if (row) events.push({ ...row, status: 'published' });
    }
    for (const p of data.places || []) {
      const { row } = cleanPlace(p, batch);
      if (row) places.push(row);
    }
  }
  console.error(`HARVEST_OVERLAY (test only): ${events.length} events, ${places.length} places from ${list.length} file(s)`);
  return (overlayRows = { events, places });
}

const eventKey = (e) => `${String(e.title).toLowerCase()}|${e.town_slug}|${e.starts_on || ''}`;
const placeKey = (p) => `${String(p.name).toLowerCase()}|${p.town_slug}`;

function mergeOverlay(events, places) {
  const extra = overlay();
  if (!extra) return { events, places };
  const have = new Set(events.map(eventKey));
  const addE = extra.events.filter((e) => !have.has(eventKey(e)) && have.add(eventKey(e)));
  const fresh = new Map(extra.places.map((p) => [placeKey(p), p]));
  return {
    events: [...events, ...addE.map((e) => ({ ...e }))],
    places: [...places.filter((p) => !fresh.has(placeKey(p))), ...[...fresh.values()].filter((p) => p.status !== 'closed').map((p) => ({ ...p }))],
  };
}

const venueStems = (name) => S.words(name).filter((w, i) => !(i === 0 && w === 'the'));
const contains = (hay, needle) => needle.length > 0 && hay.join(' ').includes(needle.join(' '));

// Index event rows for matching. Returns the multi-word tags seen, so "story time" in a keyword
// is read as one thing.
function indexEvents(events, phrases = new Set()) {
  for (const e of events) {
    for (const t of e.tags || []) { const w = S.words(t); if (w.length > 1) phrases.add(w.join(' ')); }
    e._ix = S.indexRow({ title: e.title, tags: e.tags, where: e.location, extra: [e.category, e.cost_text, e.recurrence_text].filter(Boolean).join(' '), about: e.description });
    e._venue = venueStems(String(e.location || '').split(',')[0]);
    e._filler = (e.tags || []).some((t) => FILLER_TAGS.includes(String(t).toLowerCase()));
  }
  return phrases;
}

// Index places and link each one to the upcoming events held there, so a place can be found by
// what happens at it ("dj" finds the lounge whose DJ nights are event rows).
function prepare(events, places) {
  const phrases = indexEvents(events);
  const today = todayNJ();
  const byTown = new Map();
  for (const e of events) {
    if (!e.starts_on || (e.ends_on || e.starts_on) < today) continue;
    if (!byTown.has(e.town_slug)) byTown.set(e.town_slug, []);
    byTown.get(e.town_slug).push(e);
  }
  for (const p of places) {
    for (const t of [...(p.tags || []), ...(p.best_for || [])]) { const w = S.words(t); if (w.length > 1) phrases.add(w.join(' ')); }
    const name = venueStems(p.name);
    p._events = name.join('').length < 4 ? [] : (byTown.get(p.town_slug) || [])
      .filter((e) => contains(e._venue, name) || contains(e._ix.title, name));
    const derived = [...new Set(p._events.flatMap((e) => e.tags || []))];
    p._ix = S.indexRow({ title: p.name, tags: [...(p.tags || []), ...(p.best_for || [])], derivedTags: derived, where: p.address, extra: [p.category, p.price_text].filter(Boolean).join(' '), about: p.description });
  }
  return { events, places, phrases };
}

// One shared snapshot of both tables, refreshed every minute. A turn usually makes two or three
// searches at once; they share one read, and scoring happens in memory.
let snapshot = null;
function loadData() {
  if (snapshot && Date.now() - snapshot.at < CACHE_MS) return snapshot.data;
  const floor = addDays(todayNJ(), -PAST_DAYS);
  const data = Promise.all([
    queryEvents(floor),
    fetchAll(() => db().from('venues').select(PLACE_COLS).neq('status', 'closed').order('id')),
  ]).then(([events, places]) => { const m = mergeOverlay(events, places); return { ...prepare(m.events, m.places), floor }; });
  snapshot = { at: Date.now(), data };
  data.catch(() => { snapshot = null; });
  return data;
}

// Events for a window. A window that starts before the snapshot's floor gets its own read of events.
async function dataFor(start) {
  const data = await loadData();
  if (start >= data.floor) return data;
  const older = mergeOverlay(await queryEvents(start), []).events;
  indexEvents(older);
  return { events: older, places: data.places, phrases: data.phrases };
}

// Shaping --------------------------------------------------------------------

// Keep descriptions short without cutting a sentence (or a phone number) in half: end at the last
// full sentence that fits, or failing that at a word.
function short(s, n = 200) {
  if (!s) return null;
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('; '));
  return stop > n * 0.5 ? head.slice(0, stop + 1) : head.slice(0, head.lastIndexOf(' ')).replace(/[\s,;:(-]+$/, '') + '…';
}
const crowdOf = (tags) => (tags || []).map((t) => String(t).toLowerCase()).filter((t) => S.CROWD_TAGS.has(t));

// How far, from where. One town asked about: a single number. Several ("Fair Lawn and Paramus"):
// one number per town, so nobody is told "5 minutes from both of you" when it's 5 from one.
function driveFields(slug, where) {
  if (!where || !where.anchors.length || slug === 'bergen-county') return {};
  const mins = where.anchors.map((a) => [BY_SLUG.get(a).name, driveMinutes(milesBetween(slug, a))]).filter(([, m]) => m !== null);
  if (!mins.length) return {};
  return mins.length === 1 ? { approx_drive_min: mins[0][1] } : { approx_drive_min_from: Object.fromEntries(mins) };
}

function shapeEvent(e, x = {}) {
  const on = x.dates || [];
  const range = e.starts_on ? prettyDate(e.starts_on) + (e.ends_on && e.ends_on !== e.starts_on ? ` - ${prettyDate(e.ends_on)}` : '') : 'date not announced yet';
  // For a repeating listing, "date" is the day it actually happens in the window asked about.
  const repeating = on.length && (x.kind === 'weekly' || x.kind === 'dates');
  const crowd = crowdOf(e.tags);
  const needs = S.requirements(e.tags, e.description);
  return {
    title: e.title,
    town: BY_SLUG.get(e.town_slug)?.name || e.town_slug,
    date: repeating ? on.slice(0, 3).map(prettyDate).join(', ') + (on.length > 3 ? ` (+${on.length - 3} more dates)` : '') : range,
    date_iso: on[0] || e.starts_on,
    ...(e.recurrence_text ? { when: e.recurrence_text } : {}),
    ...(repeating && e.ends_on ? { runs_through: prettyDate(e.ends_on) } : {}),
    ...(x.kind === 'loose' ? { dates_note: 'Runs on select dates in this range; the exact days are not confirmed. Say so.' }
      : x.unsure ? { dates_note: 'Not necessarily every one of these dates (see "when"). Tell them to confirm the date.' } : {}),
    time: e.time_text || 'time not posted',
    ...(x.status ? { [x.statusKey || 'right_now']: x.status } : {}),
    where: e.location || null,
    cost: e.cost_text || 'not posted',
    ...(needs.length ? { requirements: needs } : {}),
    about: short(e.description),
    category: e.category,
    tags: (e.tags || []).slice(0, 10),
    audience: audience(e),
    ...(crowd.length ? { crowd } : {}),
    ...(e.verified ? {} : { confirmed_this_year: false }),
    source: e.source_url || null,
    ...driveFields(e.town_slug, x.where),
  };
}

// An event offered alongside place results. Its time, cost and requirements sit under
// this_event_only so they can't be read as the price or hours of a place in the same answer.
function shapeEventAside(e, x = {}) {
  const full = shapeEvent(e, x);
  return {
    title: full.title, town: full.town, date: full.date, where: full.where,
    this_event_only: { time: full.time, cost: full.cost, ...(full.requirements ? { requirements: full.requirements } : {}) },
    ...(full.crowd ? { crowd: full.crowd } : {}),
    ...driveFields(e.town_slug, x.where),
  };
}

function shapePlace(p, x = {}) {
  const soon = (p._events || []).filter((e) => !e._filler || x.filler).slice(0, 2)
    .map((e) => `${e.title}${e.recurrence_text ? ` (${e.recurrence_text})` : e.starts_on ? ` (${prettyDate(e.starts_on)})` : ''}`);
  const needs = S.requirements(p.tags, p.description);
  return {
    name: p.name,
    town: BY_SLUG.get(p.town_slug)?.name || p.town_slug,
    address: p.address || null,
    category: p.category,
    good_for: p.best_for,
    tags: p.tags || [],
    price: p.price_text || null,
    hours: p.hours_text || 'not posted',
    ...(x.status ? { right_now: x.status } : {}),
    // Matched the keyword only. The row does not say it suits what was asked for in good_for.
    ...(x.unfit ? { not_marked_good_for: x.unfit } : {}),
    ...(needs.length ? { requirements: needs } : {}),
    about: short(p.description),
    ...(p.status === 'coming_soon' ? { status: 'coming soon, not open yet' } : {}),
    ...(p.opened_on ? { opened: prettyDate(p.opened_on) } : {}),
    // Titles only: what an event there costs or when it starts is on the event, not here.
    ...(soon.length ? { happening_here: soon } : {}),
    link: p.website || p.source_url || null,
    ...driveFields(p.town_slug, x.where),
  };
}

// A place offered alongside event results: its hours and price under this_place_only, same reason.
function shapePlaceAside(p, x = {}) {
  const full = shapePlace(p, x);
  return {
    name: full.name, town: full.town, address: full.address, tags: full.tags, about: full.about,
    this_place_only: { hours: full.hours, price: full.price || 'not posted', ...(full.requirements ? { requirements: full.requirements } : {}) },
    ...(full.status ? { status: full.status } : {}),
    ...(full.happening_here ? { happening_here: full.happening_here } : {}),
    link: full.link,
    ...driveFields(p.town_slug, x.where),
  };
}

let queriesHaveCount = true; // flips off if the result_count column isn't there yet (see db/migrations)
// `text` is only the search words the model chose (keyword, music, crowd, good_for), never the
// texter's own message: people put names and personal details in those. A search with no
// keyword logs its town, category and count with no text.
async function logQuery(channel, { town, category, text, count }) {
  const row = { channel, town_slug: town || null, category: category || null, query_text: text ? String(text).slice(0, 500) : null };
  try {
    if (queriesHaveCount && Number.isInteger(count)) {
      const { error } = await db().from('queries').insert({ ...row, result_count: count });
      if (!error) return;
      if (!/result_count/.test(error.message)) throw new Error(error.message);
      queriesHaveCount = false;
    }
    await q(db().from('queries').insert(row));
  } catch (e) { console.error('logQuery', e.message); }
}

// Active sponsor for a town + slot, logged as an impression. Null if the slot is open.
async function sponsoredPick(townSlug, slot, channel) {
  if (!townSlug || !slot) return null;
  const rows = await q(db().from('sponsorships').select('id,business_name,pitch,url')
    .eq('town_slug', townSlug).eq('category', slot).eq('status', 'active').limit(1));
  if (!rows.length) return null;
  const s = rows[0];
  q(db().from('impressions').insert({ sponsorship_id: s.id, channel })).catch((e) => console.error('impression', e.message));
  return { label: 'Sponsored', business: s.business_name, why: s.pitch || null, link: s.url || null };
}

// Where ----------------------------------------------------------------------

// Who we measure distance from: a named town, the towns in `near`, or (softly) the texter's home town.
function placeAsk(args, ctx) {
  const named = args.town ? resolveTown(args.town) : null;
  if (args.town && !named) return { error: `"${args.town}" isn't a Bergen County town I know. Use list_towns.` };
  const town = named === 'bergen-county' ? null : named;
  const near = resolveTowns(args.near);
  const home = ctx.homeTown && BY_SLUG.has(ctx.homeTown) && ctx.homeTown !== 'bergen-county' ? ctx.homeTown : null;
  const anchors = town ? [town] : near.length ? near : home ? [home] : [];
  return { town, anchors, firm: Boolean(town || near.length), label: anchors.map((s) => BY_SLUG.get(s).name).join(' / ') || null };
}

function milesFrom(slug, anchors) {
  let best = null;
  for (const a of anchors) {
    const m = milesBetween(slug, a);
    if (m !== null && (best === null || m < best)) best = m;
  }
  return best;
}

// Closer is better. A town they named counts fully; their home town, when they didn't say where, a third.
// When they named the town, closeness outweighs a slightly better keyword match, so the show in
// their own town leads the one 20 minutes away.
function nearBonus(miles, firm) {
  if (miles === null) return 0;
  return firm ? Math.max(0, 6 - miles * 0.6) : Math.max(0, 2 - miles * 0.2);
}

// With a town filter: keep that town (and county-wide rows); if that leaves fewer than three,
// widen to neighbors within 6 miles, then 10. Each row carries its miles so the result can say how far.
function withinTown(rows, town) {
  if (!town) return rows;
  const local = rows.filter((r) => r.row.town_slug === town || r.row.town_slug === 'bergen-county');
  if (local.length >= 3) return local;
  for (const radius of [6, 10]) {
    const wide = rows.filter((r) => r.row.town_slug === 'bergen-county' || (r.miles !== null && r.miles <= radius));
    if (wide.length >= 3 || radius === 10) return wide;
  }
  return local;
}

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

// Events ---------------------------------------------------------------------

const ACCESS_NEEDS = new Set(['wheelchair accessible', 'accessible', 'wheelchair', 'sensory friendly'].map((t) => S.words(t).join(' ')));
const DATED_BONUS = { single: 3, dates: 3, run: 2.5, weekly: 1, daily: 1, loose: 0.5 };
// Rows offered from the other table (places on an event search, events on a place search) have to
// match by tag or name, not by a loosely related word.
const CROSS_MIN = 4;

function rateEvent(e, ask) {
  const rel = ask.concepts.length ? S.scoreRow(e._ix, ask.concepts) : null;
  if (rel && !rel.matched) return null;
  const crowd = ask.crowd.length ? S.scoreRow(e._ix, ask.crowd) : null;
  if (!rel && crowd && !crowd.strong) return null;           // a crowd-only ask ("singles") has to match by tag or title
  if (ask.category && !ask.concepts.length && e.category !== ask.category) return null;
  if (ask.forKids && audience(e) !== 'good for kids') return null;
  const holiday = ask.holiday.length ? S.scoreRow(e._ix, ask.holiday) : null;
  const miles = e.town_slug === 'bergen-county' ? null : milesFrom(e.town_slug, ask.where.anchors);
  let score = (rel ? rel.score : 0) + (crowd ? crowd.score : 0)
    + (holiday && holiday.strong ? 2.5 : 0)
    + nearBonus(miles, ask.where.firm)
    + (e.verified ? 0.5 : 0)
    // A listing with a time and a price is one someone can act on.
    + (e.time_text ? 0.3 : 0) + (e.cost_text ? 0.2 : 0)
    + (ask.category && e.category === ask.category ? 1.5 : 0);
  if (e._filler && !ask.askedFiller) score -= 2.5;
  return { row: e, rel, score, miles };
}

async function searchEvents(args = {}, ctx = {}) {
  const channel = ctx.channel || 'unknown';
  const where = placeAsk(args, ctx);
  if (where.error) return { error: where.error };
  const category = args.category && EVENT_CATEGORIES.includes(args.category) ? args.category : null;

  let start = YMD.test(args.start_date || '') ? args.start_date : null;
  let end = YMD.test(args.end_date || '') ? args.end_date : null;
  if (!start && !end) ({ start, end } = thisWeekend());
  if (!start) start = todayNJ();
  if (!end) end = addDays(start, 2);
  // "2026-02-10" as the end of a window that starts in November is next February with the year mistyped.
  if (end < start && `${Number(end.slice(0, 4)) + 1}${end.slice(4)}` >= start) end = `${Number(end.slice(0, 4)) + 1}${end.slice(4)}`;
  if (end < start) [start, end] = [end, start];

  const { events, places, phrases } = await dataFor(start);
  const concepts = [...S.parseQuery(args.keyword, phrases), ...S.parseQuery(args.music, phrases)];
  const ask = {
    where, category, concepts,
    crowd: S.parseCrowd(args.crowd, phrases),
    forKids: Boolean(args.for_kids),
    // A one-to-three day window that lands on a holiday: rows tagged for it lead.
    holiday: daysBetween(start, end) <= 3 ? S.holidayTerms(start, end).flatMap((t) => S.parseQuery(t, phrases)) : [],
    askedFiller: concepts.some((c) => FILLER_KEYS.has(c.label)),
  };
  ask.access = ask.crowd.find((c) => ACCESS_NEEDS.has(c.label)) || null;

  // The clock only matters on the first day asked about: today (now), or a time they gave us.
  const now = nowNJ();
  const after = /^(\d{1,2}):(\d{2})$/.exec(args.after || '');
  const clockDay = start === now.date || after ? start : null;
  const clockMin = after ? Number(after[1]) * 60 + Number(after[2]) : now.minutes;

  const rated = events.map((e) => rateEvent(e, ask)).filter(Boolean);
  const over = [];
  // Keep the rows that happen in the window (and haven't already ended), with the dates they happen on.
  const inWindow = (list) => {
    const out = [];
    for (const r of list) {
      const occ = S.occurrences(r.row, start, end);
      let dates = occ.dates;
      let status = null;
      let timing = 0;
      if (clockDay && dates[0] === clockDay) {
        const st = S.eventStatus(r.row.time_text, weekday(clockDay), clockMin, r.row.category === 'nightlife');
        if (st && st.state === 'over') { dates = dates.slice(1); if (!dates.length) over.push(`${r.row.title} (${st.text})`); }
        else if (st) { status = st.text; timing = st.state === 'later' ? 0.6 : st.stale ? -1.5 : 0.4; }
      }
      if (!dates.length) continue;
      out.push({ ...r, dates, kind: occ.kind, unsure: occ.unsure, status, statusKey: clockDay === now.date ? 'right_now' : 'at_that_time', score: r.score + DATED_BONUS[occ.kind] + timing });
    }
    return out;
  };
  let hits = inWindow(rated);

  // An access need is a filter, not a nudge: only rows tagged for it count. If none of the rows
  // that fit the keyword carry the tag, show the ones that do; if nothing does, say so in a note.
  let accessNote = null;
  if (ask.access) {
    const tagged = (r) => S.scoreRow(r.row._ix, [ask.access]).strong;
    const marked = hits.filter(tagged);
    if (marked.length) hits = marked;
    else {
      const open = { ...ask, concepts: [], crowd: [], askedFiller: false };
      const others = inWindow(events.map((e) => rateEvent(e, open)).filter((r) => r && tagged(r)));
      if (others.length) {
        hits = others;
        accessNote = `Nothing matching "${args.keyword || args.music || 'that'}" is marked ${args.crowd} for those dates. These are the things that are marked; say that plainly.`;
      } else accessNote = `Nothing for those dates is marked ${args.crowd}. Do not say any of these is; tell them to check with the venue.`;
    }
  }
  hits = withinTown(hits, where.town);
  // Once a few rows clearly match, drop the ones that only mention the word in passing.
  if (concepts.length && !accessNote && hits.filter((h) => h.rel.strong).length >= 3) hits = hits.filter((h) => h.rel.strong);
  // Ties go to the earlier date, then rotate by day so the same titles don't always lead.
  hits.sort((a, b) => b.score - a.score || (a.dates[0] < b.dates[0] ? -1 : a.dates[0] > b.dates[0] ? 1 : 0) || hash(a.row.title + start) - hash(b.row.title + start));

  // The same show sometimes arrives from two sources under slightly different titles
  // ("Freestyle Flashback" / "Freestyle Flashback 2027"): same venue, same day, same opening words.
  const twins = new Set();
  const twin = (h) => {
    const k = `${h.row.town_slug}|${h.dates[0]}|${h.row._venue.join(' ')}|${h.row._ix.title.slice(0, 2).join(' ')}`;
    return twins.has(k) || !twins.add(k);
  };
  hits = hits.filter((h) => !twin(h));

  // No venue gets more than two rows unless they asked for it by name.
  const perVenue = new Map();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
  const picked = [];
  for (const h of hits) {
    const k = `${h.row._venue.join(' ')}|${h.row.town_slug}`;
    const n = (perVenue.get(k) || 0) + 1;
    perVenue.set(k, n);
    if (n > 2 && h.row._venue.length && !(h.rel && h.rel.where)) continue;
    if (picked.length < limit) picked.push(h);
  }

  // Little in the window that squarely matches: look just before it and up to four months after.
  // "Squarely" is judged against the best match anywhere, so a January freestyle show still
  // surfaces when all November has is 80s nights. With no keyword, only look three weeks out.
  let outside = [];
  const bestRel = Math.max(0, ...rated.map((r) => (r.rel ? r.rel.score : 0)));
  const square = (h) => !h.rel || h.rel.score >= bestRel * 0.75;
  if (hits.filter(square).length < 3) {
    const seen = new Set(hits.map((h) => h.row));
    const today = todayNJ();
    const beforeFrom = addDays(start, -3) < today ? today : addDays(start, -3);
    const reach = concepts.length || ask.crowd.length ? 120 : 21;
    for (const r of rated) {
      if (seen.has(r.row) || !square(r) || (r.row._filler && !ask.askedFiller)) continue;
      const later = S.occurrences(r.row, addDays(end, 1), addDays(end, reach));
      const earlier = beforeFrom < start ? S.occurrences(r.row, beforeFrom, addDays(start, -1)) : { dates: [] };
      const dates = [...earlier.dates.slice(-1), ...later.dates.slice(0, 2)];
      if (!dates.length) continue;
      const gap = earlier.dates.length ? 0 : daysBetween(end, later.dates[0]);
      const kind = (later.dates.length ? later : earlier).kind;
      outside.push({ ...r, dates, kind, unsure: later.unsure || earlier.unsure, score: r.score + DATED_BONUS[kind] - gap / 20 });
    }
    outside = withinTown(outside, where.town)
      .sort((a, b) => b.score - a.score || (a.dates[0] < b.dates[0] ? -1 : 1)).filter((h) => !twin(h)).slice(0, hits.length ? 3 : 5)
      .sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  }

  // Known events with no date yet. Always worth a few when they squarely match a keyword (the home
  // town's own menorah lighting may be one of them); all of them when asked for.
  let unconfirmed = [];
  if (args.include_date_tba || concepts.length) {
    unconfirmed = rated.filter((r) => !r.row.starts_on && (args.include_date_tba || square(r)) && (!where.town || r.row.town_slug === where.town || r.row.town_slug === 'bergen-county'))
      .sort((a, b) => b.score - a.score).slice(0, args.include_date_tba ? 10 : 3).map((r) => shapeEvent(r.row, { where }));
  }

  // The always-there side of the same ask, so one search answers "where can I dance" both ways.
  // A grown-up ask doesn't get a kids' play place just because both say "party", and vice versa.
  const placeConcepts = concepts.length ? concepts : ask.holiday;
  const kidAsk = ask.forKids || picked.some((h) => audience(h.row) === 'good for kids');
  const adultAsk = !ask.forKids && picked.length > 0 && picked.every((h) => audience(h.row) === 'adults');
  const related = placeConcepts.length
    ? ratePlaces(places, { where, concepts: placeConcepts, forKids: ask.forKids, seen: ctx.seen })
      .filter((r) => !(adultAsk && r.row.category === 'family') && !(kidAsk && r.row.category === 'nightlife'))
      .filter((r) => !concepts.length || r.rel.score >= CROSS_MIN).slice(0, picked.length >= 5 ? 2 : 3).map((r) => shapePlaceAside(r.row, { where }))
    : [];

  logQuery(channel, { town: where.town, category, text: [args.keyword, args.music, args.crowd].filter(Boolean).join(' '), count: hits.length });
  const slot = SPONSOR_SLOT[category] || (where.town ? 'family' : null);
  const sponsored = await sponsoredPick(where.town, slot, channel).catch(() => null);

  const nearbyOnly = where.town && picked.length && !picked.some((h) => h.row.town_slug === where.town);
  return {
    window: { from: start, to: end },
    town: where.town ? BY_SLUG.get(where.town).name : 'all of Bergen County',
    ...(where.label ? { drive_times_from: where.label } : {}),
    count: picked.length,
    ...(hits.length > picked.length ? { more_not_shown: hits.length - picked.length } : {}),
    events: picked.map((h) => shapeEvent(h.row, { ...h, where })),
    ...(accessNote ? { access_note: accessNote } : {}),
    ...(nearbyOnly ? { town_note: `Nothing matched in ${BY_SLUG.get(where.town).name} itself; these are in nearby towns.` } : {}),
    ...(over.length ? { already_over_today: over.slice(0, 6) } : {}),
    ...(outside.length ? { outside_window: { note: 'Not in the dates asked for. Offer these only as "not then, but..." with their own date.', events: outside.map((h) => shapeEvent(h.row, { ...h, where })) } } : {}),
    ...(related.length ? { places: { note: 'Always-there places that match the same keyword, separate from the events above. Hours and price under this_place_only belong to the place, not to any event.', places: related } } : {}),
    ...(unconfirmed.length ? { date_not_announced: unconfirmed } : {}),
    ...(sponsored ? { sponsored } : {}),
    note: picked.length ? undefined
      : outside.length || related.length ? 'Nothing in the Exit 163 database for those dates. Say so plainly, then offer what is listed under outside_window or places; do not invent events.'
        : 'Nothing in the Exit 163 database for that yet. Say so plainly; do not invent events.',
  };
}

// Places ---------------------------------------------------------------------

const KID_BEST = ['kids', 'toddlers', 'teens'];
const MEAL_WORDS = new Set(['lunch', 'dinner', 'eat', 'food', 'restaurant', 'meal', 'bite'].map((w) => S.words(w)[0]));

/**
 * Score places for an ask. Returns [{ row, score, miles, rel, status }] best first.
 * @param {object} ask { where, concepts, goodFor?, category?, forKids?, newOnly?, openAt?, seen? }
 */
function ratePlaces(places, ask) {
  const day = todayNJ();
  const out = [];
  for (const p of places) {
    if (ask.newOnly && !p.opened_on && p.status !== 'coming_soon') continue;
    if (ask.forKids && p.category !== 'family' && !(p.best_for || []).some((b) => KID_BEST.includes(b))) continue;
    const rel = ask.concepts.length ? S.scoreRow(p._ix, ask.concepts) : null;
    const fit = ask.goodFor && ask.goodFor.length ? S.scoreRow(p._ix, ask.goodFor) : null;
    if (ask.category && (!ask.concepts.length || ask.loose) && p.category !== ask.category) continue;
    // good_for has to be something the row is tagged with, not a word in its description.
    const fits = !fit || (fit.matched && fit.strong);
    // loose = the keyword was really "somewhere to eat": other words in it lift a row, but aren't required.
    const matches = !rel || rel.matched || ask.loose;
    if (!matches || (!fits && !rel)) continue;
    let status = null;
    if (ask.openAt) {
      const st = S.openStatus(p.hours_text, ask.openAt.dow, ask.openAt.minutes);
      if (st && !st.open) continue;
      status = st ? st.text : 'hours not posted, tell them to check before going';
    }
    const miles = p.town_slug === 'bergen-county' ? null : milesFrom(p.town_slug, ask.where.anchors);
    // Rows that fit good_for always come before rows that only match the keyword.
    const score = (rel ? rel.score : 0) + (fit ? (fits ? fit.score : -100) : 0)
      + nearBonus(miles, ask.where.firm)
      + (p.verified ? 0.5 : 0)
      + (ask.category && p.category === ask.category ? 1.5 : 0)
      + (ask.openAt && status.startsWith('open') ? 1 : 0)
      + (p.status === 'coming_soon' && !ask.newOnly ? -2 : 0)
      // Already suggested in this conversation: let something new lead a follow-up.
      + (ask.seen && ask.seen.has(p.name.toLowerCase()) ? -1.5 : 0);
    out.push({ row: p, score, miles, rel, status, unfit: fit && !fits ? ask.goodForText : null });
  }
  let rows = withinTown(out, ask.where.town);
  if (ask.concepts.length && !ask.loose && rows.filter((r) => r.rel.strong).length >= 3) rows = rows.filter((r) => r.rel.strong);
  // Ties rotate by day so the same handful doesn't always lead.
  rows.sort((a, b) => b.score - a.score || hash(a.row.name + day) - hash(b.row.name + day));
  // One mall shouldn't fill the list: at most two rows per complex unless they asked for it.
  const perSpot = new Map();
  return rows.filter((r) => {
    const complex = (r.row.tags || []).includes('american dream') ? 'american dream' : null;
    if (!complex || (r.rel && r.rel.labels.some((l) => complex.includes(l)))) return true;
    perSpot.set(complex, (perSpot.get(complex) || 0) + 1);
    return perSpot.get(complex) <= 2;
  });
}

async function searchPlaces(args = {}, ctx = {}) {
  const channel = ctx.channel || 'unknown';
  const where = placeAsk(args, ctx);
  if (where.error) return { error: where.error };
  let category = args.category && PLACE_CATEGORIES.includes(args.category) ? args.category : null;
  const { events, places, phrases } = await loadData();
  // "lunch" or "dinner" isn't something a row says about itself; it means "somewhere to eat".
  const asked = S.parseQuery(args.keyword, phrases);
  const concepts = asked.filter((c) => !MEAL_WORDS.has(c.label));
  const meal = concepts.length < asked.length;
  if (meal && !category) category = 'food';
  const now = nowNJ();
  const rows = ratePlaces(places, {
    where, concepts, category,
    loose: meal,
    goodFor: S.parseQuery(args.good_for, phrases),
    goodForText: args.good_for,
    newOnly: Boolean(args.new_only),
    openAt: args.open_now ? { dow: weekday(now.date), minutes: now.minutes } : null,
    seen: ctx.seen,
  });
  if (args.new_only) rows.sort((a, b) => String(b.row.opened_on || '').localeCompare(String(a.row.opened_on || '')));
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 20);
  const picked = rows.slice(0, limit);

  // The dated side of the same ask: the next few events that match the keyword.
  let upcoming = [];
  if (concepts.length) {
    const today = todayNJ();
    const ask = { where, category: null, concepts, crowd: [], forKids: false, holiday: [], askedFiller: concepts.some((c) => FILLER_KEYS.has(c.label)) };
    upcoming = events.map((e) => rateEvent(e, ask)).filter((r) => r && r.rel.score >= CROSS_MIN)
      .map((r) => { const occ = S.occurrences(r.row, today, addDays(today, 45)); return occ.dates.length ? { ...r, dates: occ.dates, kind: occ.kind, unsure: occ.unsure, score: r.score + DATED_BONUS[occ.kind] - daysBetween(today, occ.dates[0]) / 20 } : null; })
      .filter(Boolean);
    upcoming = withinTown(upcoming, where.town).sort((a, b) => b.score - a.score).slice(0, 3).map((h) => shapeEventAside(h.row, { ...h, where }));
  }

  logQuery(channel, { town: where.town, category, text: [args.keyword, args.good_for].filter(Boolean).join(' '), count: rows.length });
  const sponsored = await sponsoredPick(where.town, SPONSOR_SLOT[category] || category, channel).catch(() => null);
  const nearbyOnly = where.town && picked.length && !picked.some((r) => r.row.town_slug === where.town);
  return {
    town: where.town ? BY_SLUG.get(where.town).name : 'all of Bergen County',
    ...(where.label ? { drive_times_from: where.label } : {}),
    count: picked.length,
    ...(rows.length > picked.length ? { more_not_shown: rows.length - picked.length } : {}),
    places: picked.map((r) => shapePlace(r.row, { where, status: r.status, unfit: r.unfit })),
    ...(nearbyOnly ? { town_note: `Nothing matched in ${BY_SLUG.get(where.town).name} itself; these are in nearby towns.` } : {}),
    ...(upcoming.length ? { upcoming_events: { note: 'Dated events that match the keyword, separate from the places above. The time, cost and requirements under this_event_only belong to that one event, never to a place, even when it is held there.', events: upcoming } } : {}),
    ...(sponsored ? { sponsored } : {}),
    note: picked.length ? undefined
      : upcoming.length ? 'No matching always-there places in the Exit 163 database yet, but see upcoming_events. Do not invent places.'
        : 'No matching places in the Exit 163 database yet. Say so; do not invent places.',
  };
}

async function listTowns() {
  return { county: 'Bergen County, NJ', towns: TOWNS.filter((t) => t.slug !== 'bergen-county').map((t) => t.name) };
}

async function sponsorAvailability(args = {}) {
  const townSlug = resolveTown(args.town);
  if (!townSlug) return { error: 'Unknown town.' };
  const taken = await q(db().from('sponsorships').select('category').eq('town_slug', townSlug).eq('status', 'active'));
  const takenSet = new Set(taken.map((r) => r.category));
  return { town: BY_SLUG.get(townSlug).name, open: SPONSOR_CATEGORIES.filter((c) => !takenSet.has(c)), taken: [...takenSet] };
}

// JSON-schema definitions shared by Claude tool use and MCP tools/list.
const NEAR_DESC = 'Rank by closeness to this town (or several: "Hackensack, Teaneck, Englewood") across the whole county, nearest first among good matches. Use it for "near me", "close to X" and whenever you know where they are. Each result then has approx_drive_min, a rough estimate; with several towns it is approx_drive_min_from, one number per town.';
const TOOL_DEFS = [
  {
    name: 'search_events',
    description: 'Search verified, dated things to do in Bergen County, NJ from the Exit 163 database: parties and DJ nights, shows, classes, markets, games, holiday events. Defaults to this weekend (Fri-Sun, NJ time). Results are ranked by how well they fit the ask, one-off events ahead of standing weekly nights, and only include things that actually happen on the days asked (a "Every Tuesday" night never shows for a Saturday). Each event has its date in the window, time, cost, tags, an audience field ("good for kids", "all ages allowed, not made for kids", "adults", or "not marked as a kids event"; only call something kid-friendly when it says "good for kids"), a crowd field when the listing says who it is for (30+, singles, beginner friendly...), the source link, and confirmed_this_year: false when the date is carried over from a past year and not yet confirmed (say so). DJ, band, comedian and host names are in the title or about text when known. A requirements field lists what someone must do or be to go (registration, residents only, RSVP, age limits, pay ahead, rain cancels); pass it on whenever you recommend that event. Every time, cost and requirement belongs to its own row only. Also returned when relevant: places (always-there spots that match the same keyword, kept separate), outside_window (the next matches on other dates when the window is thin), date_not_announced, already_over_today, and one item labeled "Sponsored" (always present it as sponsored).',
    input_schema: {
      type: 'object',
      properties: {
        town: { type: 'string', description: 'Only this Bergen County town, e.g. "Ridgewood" (county-wide events are included; if fewer than three match, nearby towns are added and marked with approx_drive_min). Omit for the whole county.' },
        near: { type: 'string', description: NEAR_DESC },
        start_date: { type: 'string', description: 'YYYY-MM-DD (NJ time). Omit for this weekend. For "coming up" or "anytime soon", search about 90 days ahead.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        category: { type: 'string', enum: EVENT_CATEGORIES, description: 'Filters when there is no keyword. With a keyword it only nudges the ranking, so a concert filed under arts still shows for a nightlife ask.' },
        keyword: { type: 'string', description: 'The thing itself in one to three plain words: "dj", "trivia", "tree lighting", "story time", "paint and sip", "5k", or a performer or venue name. Related words are matched for you (dj finds dance parties, hike finds trails, hanukkah finds menorah lightings). Leave towns, days and ages out of it.' },
        music: { type: 'string', description: 'Music style if they named one: latin, salsa, bachata, reggaeton, hip hop, r&b, 90s, 80s, freestyle, disco, house, country, jazz, rock...' },
        crowd: { type: 'string', description: 'Who it is for, if they said: "30s and 40s", "40+", "singles", "seniors", "teens", "toddlers", "date night", "groups", "beginner friendly", "dog friendly", "wheelchair accessible". Boosts rows tagged for that crowd; it does not prove anything about a row without the tag. An access need ("wheelchair accessible", "sensory friendly") is a filter: only rows tagged for it come back, and access_note says so when none are.' },
        after: { type: 'string', description: 'A 24-hour time like "21:00" for the first day of the window: leaves out things that will have ended by then. Defaults to the current NJ time when the window starts today. Use it when they tell you the time ("it\'s 9pm") or say "after 10".' },
        include_date_tba: { type: 'boolean', description: 'Also return known events whose date is not announced yet.' },
        for_kids: { type: 'boolean', description: 'Only events marked as good for kids (family category or tagged kids/family/toddlers/teens/santa/story time). Use when they are going with kids.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 8.' },
      },
      additionalProperties: false,
    },
    run: searchEvents,
  },
  {
    name: 'search_places',
    description: 'Search always-there places in Bergen County, NJ from the Exit 163 database: restaurants, cafes, bars, lounges, live music rooms, karaoke, indoor play, parks, museums, farms, rinks. Use for "where should we eat", "rainy day with kids", "date night", "somewhere to dance", "new restaurants". Results are ranked by fit and closeness and include hours, price, tags, requirements and happening_here (titles of dated events at that place). When a keyword is given, upcoming_events lists the next dated events that match it, kept separate: an event\'s time, cost and requirements are its own and never describe the place. A result may include one item labeled "Sponsored"; always present it as sponsored.',
    input_schema: {
      type: 'object',
      properties: {
        town: { type: 'string', description: 'Only this Bergen County town (if fewer than three match, nearby towns are added and marked with approx_drive_min). Omit for the whole county.' },
        near: { type: 'string', description: NEAR_DESC },
        category: { type: 'string', enum: PLACE_CATEGORIES, description: 'Filters when there is no keyword; with a keyword it only nudges the ranking.' },
        good_for: { type: 'string', description: 'One of: kids, toddlers, teens, date night, rainy day, brunch, groups, dogs, free, budget, live music, late night, special occasion' },
        keyword: { type: 'string', description: 'One to three plain words: pizza, korean bbq, trampoline, coffee, brewery, lounge, dj, karaoke, rooftop, pickleball. Related words are matched for you.' },
        open_now: { type: 'boolean', description: 'They want to go right now: drops places whose posted hours say they are closed at the current NJ time and adds right_now to each result.' },
        new_only: { type: 'boolean', description: 'Only recently opened or coming-soon places.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Default 6.' },
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
  {
    name: 'sponsor_availability',
    description: 'For local businesses: which Exit 163 sponsor slots (one per town per category: food, family, nightlife, shopping, services) are still open in a town. Sign up at https://www.exit163.com/claim',
    input_schema: {
      type: 'object',
      properties: { town: { type: 'string' } },
      required: ['town'],
      additionalProperties: false,
    },
    run: sponsorAvailability,
  },
];

module.exports = { TOOL_DEFS, searchEvents, searchPlaces, listTowns, sponsorAvailability, logQuery, EVENT_CATEGORIES, SPONSOR_CATEGORIES };
