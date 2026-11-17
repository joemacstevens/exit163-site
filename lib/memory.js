// What Exit 163 remembers about each texter, one fact per row (table subscriber_facts).
// Used by the text agent (remember / forget tools), the nightly review (lib/reflect.js)
// and the Friday personal picks (lib/personalize.js).
const { db, q } = require('./db');
const { BY_SLUG } = require('./towns');
const { todayNJ } = require('./dates');
const followups = require('./followups');

const KINDS = ['kid', 'interest', 'dislike', 'food', 'budget', 'schedule', 'access', 'other'];
const MAX_FACTS = 30;
const LABEL = {
  interest: 'Into', dislike: 'Not into', food: 'Food', budget: 'Budget',
  schedule: 'Schedule', access: 'Needs', other: 'Also',
};

const thisYear = () => Number(todayNJ().slice(0, 4));
const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// Facts must never carry contact details, even if the model tries.
const LOOKS_PRIVATE = /@|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|\b\d+\s+\w+\s+(st|street|ave|avenue|rd|road|ln|lane|dr|drive|ct|court|pl|place)\b/i;

// Second line of defense behind the agent's instructions. Each returns why a fact is refused, or null.
const ABOUT_HEALTH = /\b(disab\w*|diagnos\w*|cancer|illness|surgery|pregnan\w*|therapy|medication|rehab|autis\w*|adhd|anxiety|depress\w*|dementia|arthritis)\b/i;
const ABOUT_RELATIONSHIP = /\b(divorc\w*|separated|widow\w*|newly single|break-?up|broke up|custody)\b/i;
const ABOUT_MONEY = /\b(broke|debt|unemployed|laid off|can'?t afford|money (?:is )?(?:tight|trouble)|struggling)\b/i;
const ABOUT_AGE_OR_OCCASION = /\b\d{2}(?:st|nd|rd|th)\b|\bbirthdays?\b|\banniversar\w*|\b\d{2}\s*(?:years?|yrs?)[- ]old\b|\b(?:i'?m|am|age|aged|turning)\s+\d{2}\b(?!\s*(?:min|mile|buck|dollar|percent))/i;
const ABOUT_SOMEONE_ELSE = /\b(?:mom|mother|dad|father|in-?laws?|grand(?:ma|pa|mother|father|parents?)|aunt|uncle|cousin|visitors?|guests?|out[- ]of[- ]town(?:ers?)?)\b/i;
function refuse(kind, fact) {
  if (LOOKS_PRIVATE.test(fact)) return 'contact details are never stored';
  if (ABOUT_HEALTH.test(fact)) return 'health details are never stored; save the need instead, e.g. access: "step-free venues"';
  if (ABOUT_RELATIONSHIP.test(fact)) return 'relationship details are never stored';
  if (ABOUT_MONEY.test(fact)) return 'money trouble is never stored; a budget like "free or cheap" is fine';
  if (kind === 'kid') return null;
  if (ABOUT_AGE_OR_OCCASION.test(fact)) return "one-off occasions and adults' ages or birthdays aren't stored";
  if (ABOUT_SOMEONE_ELSE.test(fact)) return 'that is about a guest or relative, not the texter: use it now, do not save it';
  return null;
}

// Access and budget are stored as what to look for, never as a condition or a hardship.
function soften(kind, fact) {
  // "Singles events" is a relationship status by another name. What matters for picks is the wish.
  if (kind === 'interest' && /\bsingles?\b|\bdating\b/i.test(fact)) return 'meeting new people (mixers, social groups)';
  if (kind === 'access') {
    if (/wheelchair/i.test(fact) && !/accessible|friendly|access\b/i.test(fact)) return 'step-free, wheelchair-accessible venues';
    if (/can'?t walk|cannot walk|trouble walking|limited mobility|mobility (?:issue|problem)/i.test(fact)) return 'little walking, seating close by';
  }
  if (kind === 'budget') {
    const plain = fact.replace(/\b(?:very |really |pretty )?(?:tight|limited|strict|small|low)\s+budget\b[,:;]?\s*/i, '').trim();
    return plain || 'free or cheap';
  }
  return fact;
}

// A fact has to rest on the texter's own words, not on what we suggested to them. The agent
// passes the words it is going on (they_said); every word of that quote has to be in what they
// actually texted. Case, punctuation and order don't matter, so a slightly loose quote still counts.
const wordsOf = (s) => String(s || '').toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) || [];
/** @param {string} quote  @param {string[]} theirTexts  the texter's own messages */
function saidIt(quote, theirTexts = []) {
  const quoted = wordsOf(quote);
  if (!quoted.some((w) => w.length >= 3)) return false;
  const said = new Set(theirTexts.flatMap(wordsOf));
  return quoted.every((w) => said.has(w));
}

// "Is Paper Moon playing at the Williams Center?" is a movie, not a band. A music interest has to
// rest on a music word in their quote; "playing", "show" or "on" alone don't count.
const MUSIC_FACT = /\b(?:music|concerts?|bands?|gigs?)\b/i;
const MUSIC_SAID = /\b(?:music\w*|concerts?|bands?|gigs?|jazz|rock|blues|folk|bluegrass|country|hip[- ]?hop|rap|r&b|reggae|punk|metal|indie|edm|dj|djs|orchestra|symphony|philharmonic|opera|choir|singers?|songs?|songwriters?|acoustic|tribute|covers?|open mic|karaoke|guitar|piano)\b/i;
/** Returns why an interest in music isn't backed by their words, or null. */
function musicUnsupported(kind, fact, quote) {
  if (kind !== 'interest' || !MUSIC_FACT.test(String(fact || ''))) return null;
  if (MUSIC_SAID.test(String(quote || ''))) return null;
  return 'nothing they said is about music; "playing" a movie or show is not live music, and one question about one event is not a taste.';
}

async function loadFacts(phone) {
  return q(db().from('subscriber_facts').select('id,kind,fact,born_year,source,created_at')
    .eq('phone', phone).order('kind').order('born_year', { ascending: false }).order('id'));
}

function kidAge(f, year = thisYear()) {
  return f.born_year ? Math.max(0, year - f.born_year) : null;
}

function factText(f, year) {
  if (f.kind === 'kid') {
    const age = kidAge(f, year);
    const extra = f.fact && !/^kid\b/i.test(f.fact) ? ` (${f.fact})` : '';
    return (age === null ? 'kid, age unknown' : `kid, about ${age}`) + extra;
  }
  return `${LABEL[f.kind] || f.kind}: ${f.fact}`;
}

// For the agent's context: one line per fact with its id, so it can forget by id.
function describeFacts(facts) {
  if (!facts.length) return '';
  const year = thisYear();
  return 'What you remember about them (id in brackets; call forget with the id if something is wrong or has changed):\n'
    + facts.map((f) => `- [${f.id}] ${factText(f, year)}`).join('\n');
}

// Plain-English summary for "what do you know about me" and the personal-pick prompt.
function summarize({ firstName, townName, facts }) {
  const year = thisYear();
  const bits = [];
  if (firstName) bits.push(`name: ${firstName}`);
  if (townName) bits.push(`home town: ${townName}`);
  const kids = facts.filter((f) => f.kind === 'kid');
  if (kids.length) {
    const ages = kids.map((k) => kidAge(k, year)).filter((a) => a !== null).sort((a, b) => a - b);
    bits.push(`${kids.length} kid${kids.length > 1 ? 's' : ''}${ages.length ? ` (about ${ages.join(', ')})` : ''}`);
  }
  for (const kind of KINDS.filter((k) => k !== 'kid')) {
    const items = facts.filter((f) => f.kind === kind).map((f) => f.fact);
    if (items.length) bits.push(`${LABEL[kind].toLowerCase()}: ${items.join(', ')}`);
  }
  return bits;
}

/**
 * Save facts. Skips duplicates (same kind + same text, or a kid with the same birth year).
 * @param {string} phone
 * @param {Array<{kind:string, fact?:string, kid_age?:number}>} items
 * @param {'chat'|'review'|'onboarding'} source
 */
async function remember(phone, items = [], source = 'chat') {
  const existing = await loadFacts(phone);
  const year = thisYear();
  const saved = [];
  const skipped = [];
  for (const it of Array.isArray(items) ? items : []) {
    const kind = KINDS.includes(it.kind) ? it.kind : 'other';
    let fact = clean(it.fact);
    let born_year = null;
    if (kind === 'kid') {
      const age = Number(it.kid_age);
      if (Number.isFinite(age) && age >= 0 && age < 26) born_year = year - Math.round(age);
      // Keep only real context ("plays soccer"); drop restatements like "child age 7".
      const context = fact.replace(/\b(a|the|my|our|child|children|kid|kids|son|daughter|age[sd]?|years?|yrs?|old|about)\b|\d+|[,()-]/gi, '').trim();
      fact = context.length >= 3 ? fact : 'kid';
      if (born_year !== null && existing.some((f) => f.kind === 'kid' && f.born_year === born_year) && !/twin/i.test(fact)) { skipped.push(`kid ~${year - born_year} (already saved)`); continue; }
    } else {
      if (!fact) continue;
    }
    // Refuse on what the agent wrote, then reword what's left (so "mom can't walk far" is refused, not rephrased).
    const why = refuse(kind, fact);
    if (why) { skipped.push(why); continue; }
    if (kind !== 'kid') {
      fact = soften(kind, fact);
      if (existing.some((f) => f.kind === kind && f.fact.toLowerCase() === fact.toLowerCase())) { skipped.push(`${fact} (already saved)`); continue; }
    }
    const [row] = await q(db().from('subscriber_facts').insert({ phone, kind, fact, born_year, source }).select('id,kind,fact,born_year,source,created_at'));
    existing.push(row);
    saved.push(factText(row, year));
  }
  // Keep the list short: drop the oldest non-kid facts past the cap.
  if (existing.length > MAX_FACTS) {
    const extra = existing.filter((f) => f.kind !== 'kid').sort((a, b) => a.id - b.id).slice(0, existing.length - MAX_FACTS);
    if (extra.length) await q(db().from('subscriber_facts').delete().in('id', extra.map((f) => f.id)));
  }
  return { saved, ...(skipped.length ? { skipped } : {}) };
}

async function forget(phone, ids = []) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!list.length) return { removed: 0 };
  const rows = await q(db().from('subscriber_facts').delete().eq('phone', phone).in('id', list).select('id'));
  return { removed: rows.length };
}

// FORGET: wipe everything we know (facts, name, town, notes, chat history, personal picks, follow-up questions).
// Subscription status (JOIN, email) is kept; STOP is how they leave.
async function forgetAll(phone) {
  await q(db().from('subscriber_facts').delete().eq('phone', phone));
  await q(db().from('personal_picks').delete().eq('phone', phone));
  await followups.forget(phone);
  await q(db().from('sms_messages').delete().eq('phone', phone));
  // prefs.recent is the digest of recent lookups (lib/recall.js): part of the chat, so it goes too.
  const [before] = await q(db().from('sms_users').select('prefs').eq('phone', phone));
  const { recent, ...prefs } = before?.prefs || {};
  const [user] = await q(db().from('sms_users')
    .update({ first_name: null, town_slug: null, notes: null, prefs, memory_reviewed_at: new Date().toISOString() })
    .eq('phone', phone).select('email'));
  return { email: user?.email || null };
}

function townName(slug) {
  return slug ? BY_SLUG.get(slug)?.name || null : null;
}

module.exports = { refuse, soften, saidIt, musicUnsupported, KINDS, loadFacts, describeFacts, summarize, remember, forget, forgetAll, factText, kidAge, townName };
