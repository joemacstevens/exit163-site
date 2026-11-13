// Short-term recall: a compact digest of what the search tools returned earlier in a conversation.
// Chat history only keeps the texts themselves, so without this a follow-up like "what are their
// Saturday hours?" can't see the hours the tools returned two turns ago.
// The digest holds database rows only (names, towns, times, hours, prices, links), never anything
// about the texter. It lives in sms_users.prefs.recent, goes stale after a day, and FORGET wipes it.
const MAX_SUGGESTED = 14; // rows the agent actually named in a reply, kept in full
const MAX_OTHER = 10;     // rows that came back but weren't used yet, kept as one-liners
const FRESH_HOURS = 24;

const trim = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const host = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// Pull the rows out of one search tool result. Rows offered "on the side" (places on an event
// search, events on a place search) keep their own time, cost and hours under this_*_only.
function collect(toolName, out) {
  if (!out || out.error) return [];
  const items = [];
  const needs = (r) => (r && r.length ? { q: trim(r.join('; '), 240) } : {});
  const event = (e) => {
    const own = e.this_event_only || e;
    items.push({
      k: 'e', n: e.title, t: e.town, d: e.date, ...(e.when ? { r: trim(e.when, 60) } : {}), ti: trim(own.time, 90),
      c: trim(own.cost, 80), ...needs(own.requirements), ...(e.where ? { w: trim(e.where, 70) } : {}), ...(e.source ? { l: host(e.source) } : {}),
    });
  };
  const place = (p) => {
    const own = p.this_place_only || p;
    items.push({
      k: 'p', n: p.name, t: p.town, h: trim(own.hours, 170), ...(own.price && own.price !== 'not posted' ? { c: trim(own.price, 60) } : {}), ...needs(own.requirements),
      ...(p.address ? { w: trim(p.address, 70) } : {}), ...(p.status ? { s: p.status } : {}), ...(p.link ? { l: host(p.link) } : {}),
    });
  };
  if (toolName === 'search_events') {
    (out.events || []).forEach(event);
    (out.outside_window?.events || []).forEach(event);
    (out.date_not_announced || []).forEach(event);
    (out.places?.places || []).forEach(place);
  } else if (toolName === 'search_places') {
    (out.places || []).forEach(place);
    (out.upcoming_events?.events || []).forEach(event);
  }
  return items;
}

const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !SKIP.has(w));
const SKIP = new Set(['with', 'live', 'night', 'music', 'party', 'bergen', 'county', 'restaurant', 'tavern', 'house', 'club', 'park', 'center', 'weekend', 'weekends']);

// Did the reply name this row? The agent shortens and rewords ("Jumpin' Jax", "The Georgia 5's
// 80s Dance Party"), so go by the first two words of the place or venue name, or by most of an
// event title's distinctive words.
function mentioned(item, reply) {
  const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').replace(/^the /, '').trim();
  const text = ` ${plain(reply)} `;
  const named = (s) => {
    const name = plain(s);
    const lead = name.split(' ').slice(0, 2).join(' ');
    return (name.length >= 4 && text.includes(` ${name} `)) || (lead.includes(' ') && lead.length >= 7 && text.includes(` ${lead}`));
  };
  if (named(item.n)) return true;
  if (item.k === 'p') return false;
  if (item.w && named(item.w.split(',')[0])) return true;
  const want = [...new Set(tokens(item.n))];
  const hit = want.filter((w) => text.includes(` ${w}`)).length;
  return want.length >= 2 && hit >= Math.ceil(want.length * 0.6);
}

const fresh = (digest, now = Date.now()) => Boolean(digest && Array.isArray(digest.items) && now - new Date(digest.at).getTime() < FRESH_HOURS * 3600e3);

/**
 * Fold this turn's tool rows into the stored digest.
 * @param {object|null} prev   prefs.recent from the last turn
 * @param {Array} items        rows from collect() for this turn
 * @param {string} reply       what the agent texted back
 */
function merge(prev, items, reply) {
  const old = fresh(prev) ? prev.items : [];
  const byKey = new Map();
  const key = (i) => `${i.k}|${i.n}|${i.t}|${i.d || ''}`.toLowerCase();
  for (const i of old) byKey.set(key(i), i);
  for (const i of items) {
    const was = byKey.get(key(i));
    byKey.delete(key(i)); // re-insert so the newest sits last
    byKey.set(key(i), { ...i, m: Boolean((was && was.m) || mentioned(i, reply)) });
  }
  // A row suggested in an earlier turn stays suggested; one named only now gets marked.
  for (const [k, i] of byKey) if (!i.m && mentioned(i, reply)) byKey.set(k, { ...i, m: true });
  const all = [...byKey.values()];
  const suggested = all.filter((i) => i.m).slice(-MAX_SUGGESTED);
  const other = all.filter((i) => !i.m).slice(-MAX_OTHER);
  return { at: new Date().toISOString(), items: [...suggested, ...other] };
}

function line(i) {
  if (i.k === 'e') {
    return `- ${i.n} (event, ${i.t}): ${i.d}${i.r ? `, ${i.r}` : ''}; time: ${i.ti}; cost: ${i.c}${i.q ? `; requirements: ${i.q}` : ''}${i.w ? `; at ${i.w}` : ''}${i.l ? `; ${i.l}` : ''}`;
  }
  return `- ${i.n} (place, ${i.t}${i.s ? `, ${i.s}` : ''}): hours: ${i.h}${i.c ? `; price: ${i.c}` : ''}${i.q ? `; requirements: ${i.q}` : ''}${i.w ? `; ${i.w}` : ''}${i.l ? `; ${i.l}` : ''}`;
}

// Text for the agent's context, or '' when there is nothing recent.
function describe(digest) {
  if (!fresh(digest) || !digest.items.length) return '';
  const suggested = digest.items.filter((i) => i.m);
  const other = digest.items.filter((i) => !i.m);
  let out = '';
  if (suggested.length) {
    out += 'Already looked up and suggested earlier in this conversation (straight from your tools, still true). Use these only to answer follow-ups about the same items (hours, price, time, tickets, address, requirements); each line\'s details belong to that item alone, and "not posted" means they don\'t say. A new ask (a different kind of thing, another day, another place) always gets a new search:\n'
      + suggested.map(line).join('\n');
  }
  if (other.length) {
    out += `${out ? '\n' : ''}Also came back earlier but you haven't suggested them yet. Fresh options for a follow-up, but this is all you know about them: say only what's on the line, or search again for more:\n`
      + other.map((i) => (i.k === 'e' ? `- ${i.n} (event, ${i.t}): ${i.d}; time: ${i.ti}; cost: ${i.c}${i.q ? `; requirements: ${i.q}` : ''}` : `- ${i.n} (place, ${i.t})${i.q ? `: requirements: ${i.q}` : ''}`)).join('\n');
  }
  return out;
}

// Lowercased names already suggested, so a new search can lead with something else.
function suggestedNames(digest) {
  return new Set(fresh(digest) ? digest.items.filter((i) => i.m).map((i) => String(i.n).toLowerCase()) : []);
}

module.exports = { collect, mentioned, merge, describe, suggestedNames, fresh };
