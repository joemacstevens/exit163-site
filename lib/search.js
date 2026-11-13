// Matching and schedule parsing behind the search tools (lib/tools.js).
// Everything here is pure: rows and words in, scores and dates out. Nothing in this file adds a
// fact to a row. Related words only widen which rows are found; what the agent may say still has
// to be written in the row it gets back.
const { addDays, weekday, clockText } = require('./dates');

// Words ----------------------------------------------------------------------

// 4-letter words that would collide with another word if the final "e" were dropped (wine/win).
const KEEP_E = new Set(['wine', 'bare', 'note', 'care', 'more', 'here', 'were', 'fine']);
const VOWEL = /[aeiouy]/;

// One light stem per word so dance/dancing/dances and hike/hiking meet. Tokens with digits or
// symbols ("90s", "30+", "r&b", "5k") are kept whole.
function stem(tok) {
  let t = tok;
  if (/[^a-z]/.test(t) || t.length <= 2) return t;
  if (t.endsWith('ies') && t.length > 4) t = t.slice(0, -3) + 'y';
  else if (t.endsWith('s') && t.length >= 3 && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if (t.endsWith('ing') && t.length >= 6 && VOWEL.test(t.slice(0, -3))) {
    t = t.slice(0, -3);
    if (/([bdgmnprt])\1$/.test(t)) t = t.slice(0, -1); // running -> run
  }
  if (t.endsWith('e') && t.length >= 4 && !KEEP_E.has(t)) t = t.slice(0, -1);
  return t;
}

function words(text) {
  const s = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’']/g, '').replace(/\s&\s/g, ' and ');
  return (s.match(/[a-z0-9]+(?:[&+][a-z0-9]+)*\+?/g) || []).map(stem);
}

// Related terms: asking for the key also finds rows about the listed terms, at a lower weight
// (0.7 unless given). "=term" is the same thing spelled another way (full weight).
const RELATED = {
  // nightlife and dancing
  'dj': ['=deejay', 'dancing', 'dance party', 'dance floor', 'nightclub', 'dance club'],
  'dancing': ['dj', 'dance party', 'dance floor', 'nightclub', 'dance club', 'salsa:0.5', 'bachata:0.5', 'line dancing:0.5'],
  'dance party': ['dj', 'dancing', 'nightclub:0.5'],
  'nightclub': ['=night club', '=dance club', 'dj', 'dancing', 'dance party', 'lounge:0.5', 'bottle service:0.5'],
  'party': ['dance party', 'bash:0.5'],
  'lounge': ['bottle service', 'hookah', 'cocktails:0.5'],
  'bottle service': ['lounge', 'vip', 'nightclub:0.5'],
  'hookah': ['lounge'],
  'rooftop': ['roof deck', 'skyline views:0.5'],
  'latin': ['salsa', 'bachata', 'reggaeton', 'merengue', 'cumbia'],
  'salsa': ['latin', 'bachata:0.5', 'merengue:0.5'],
  'bachata': ['latin', 'salsa:0.5'],
  'reggaeton': ['latin', 'dembow:0.5'],
  'hip hop': ['=hiphop', 'rap', 'r&b'],
  'r&b': ['=rnb', '=r and b', 'hip hop', 'soul:0.5'],
  '90s': ['=1990s', '=nineties', 'throwback', '2000s:0.4'],
  '80s': ['=1980s', '=eighties', 'freestyle:0.6', 'new wave', 'retro:0.5', 'throwback:0.5'],
  '70s': ['=1970s', 'disco'],
  '2000s': ['=y2k', 'throwback', '90s:0.4'],
  'disco': ['70s', 'funk'],
  'freestyle': ['latin freestyle', '80s:0.4'],
  'throwback': ['90s', '80s', '2000s', 'retro', 'old school'],
  'edm': ['house music', 'techno', 'electronic'],
  'country': ['line dancing', 'honky tonk', 'bluegrass:0.5'],
  'line dancing': ['country'],
  'jazz': ['big band', 'swing:0.5', 'blues:0.5'],
  'rock': ['classic rock', 'cover band:0.5'],
  'metal': ['punk:0.5', 'hardcore:0.5'],
  'punk': ['metal:0.5', 'hardcore:0.5'],
  'tribute': ['=tribute band', 'cover band'],
  'cover band': ['tribute', 'covers', 'live music:0.5'],
  'live music': ['band', 'concert', 'cover band', 'acoustic', 'live band', 'live entertainment'],
  'music': ['live music', 'concert', 'band', 'dj:0.5'],
  'band': ['live music', 'cover band', 'concert:0.5'],
  'concert': ['live music', 'music:0.5', 'band:0.5'],
  'karaoke': ['noraebang', 'karaoke rooms', 'sing along:0.5'],
  'noraebang': ['karaoke', 'karaoke rooms'],
  'comedy': ['stand up', '=standup', 'comedian', 'improv', 'open mic:0.4'],
  'stand up': ['=standup', 'comedy', 'comedian'],
  'open mic': ['open jam', 'jam night:0.5'],
  'trivia': ['quiz', 'quizzo', 'music bingo:0.4'],
  'bingo': ['music bingo'],
  'games': ['arcade', 'game night', 'board games', 'bowling', 'darts', 'billiards', 'bingo', 'music bingo', 'mini golf', 'laser tag', 'trivia:0.5'],
  'game night': ['board games', 'games:0.5'],
  'board games': ['game night', 'games:0.5'],
  'arcade': ['games', 'pinball', 'vr:0.5'],
  'singles': ['speed dating', 'mixer', 'meetup:0.5'],
  'speed dating': ['singles', 'mixer'],
  'mixer': ['singles', 'meetup', 'speed dating'],
  'meetup': ['mixer', 'social:0.5', 'singles:0.5', 'game night:0.5', 'run club:0.5'],
  'meet people': ['meetup', 'singles', 'mixer', 'game night', 'run club', 'class:0.5'],
  'ladies night': ['girls night'],
  'girls night': ['ladies night', 'dancing:0.4'],
  'happy hour': ['drink specials'],
  'brunch': ['bottomless', 'day party:0.5'],
  'day party': ['brunch:0.5', 'dj:0.5'],
  'late night': ['open late', 'after hours'],
  'date night': ['romantic', 'date'],
  'private room': ['private party', 'private dining', 'private events', 'banquet', 'catering:0.5'],
  'private party': ['private room', 'private dining', 'private events', 'banquet'],
  // food and drink
  'wine': ['tasting', 'winery', 'wine bar', 'vineyard'],
  'wine bar': ['=wine', 'tasting room', 'winery', 'wine tasting'],
  'tasting': ['wine', 'beer:0.5', 'whiskey', 'bourbon', 'pairing', 'tasting room'],
  'beer': ['brewery', 'craft beer', 'taproom', 'tasting:0.5'],
  'brewery': ['beer', 'craft beer', 'taproom'],
  'cocktails': ['cocktail bar', 'speakeasy', 'lounge:0.5'],
  'food festival': ['festival', 'food trucks', 'tasting', 'restaurant week'],
  'food trucks': ['food truck', 'festival:0.4'],
  'bbq': ['=barbecue', 'korean bbq:0.6'],
  'korean bbq': ['=kbbq', 'korean'],
  'coffee': ['cafe', 'espresso'],
  'cafe': ['coffee', 'bakery:0.4'],
  'tea': ['afternoon tea', 'tea room'],
  'pizza': ['pizzeria', 'bar pie'],
  'tacos': ['mexican', 'taqueria'],
  // making things
  'paint and sip': ['=sip and paint', 'paint night', 'painting', 'paint party'],
  'painting': ['paint and sip', 'paint night', 'art class'],
  'pottery': ['ceramics', 'clay', 'pottery painting'],
  'class': ['workshop', 'lesson'],
  'workshop': ['class', 'hands on:0.5'],
  'art': ['gallery', 'exhibit', 'exhibition', 'art show', 'museum:0.5'],
  'crafts': ['craft', 'workshop', 'diy'],
  // family
  'kids': ['family', 'children', 'child', 'family friendly', 'toddlers:0.5', 'all ages:0.4'],
  'family': ['kids', 'children', 'family friendly', 'all ages:0.5'],
  'children': ['kids', 'family', 'family friendly'],
  'toddlers': ['story time', 'preschool', 'babies', 'baby', 'little ones', 'tots', 'kids:0.5'],
  'baby': ['toddlers', 'infant'],
  'teens': ['teenagers', 'tweens', 'high school:0.4'],
  'seniors': ['50+', '55+', 'older adults', 'active adults'],
  'story time': ['=storytime', 'story hour', 'read aloud', 'library:0.4'],
  'music class': ['music together', 'sing along:0.5', 'toddlers:0.4'],
  // holidays
  'santa': ['santa photos', 'breakfast with santa', 'tree lighting:0.4'],
  'tree lighting': ['christmas tree', 'santa:0.4'],
  'christmas': ['=xmas', 'santa', 'tree lighting', 'holiday:0.5', 'nutcracker:0.4'],
  // One family: someone asking for menorah lightings wants the Hanukkah show too, and the other way round.
  'hanukkah': ['=chanukah', '=hanukah', '=chanukkah', '=menorah', 'latkes', 'dreidel', 'festival of lights'],
  'menorah': ['=hanukkah', '=chanukah', '=hanukah', '=chanukkah'],
  'menorah lighting': ['=menorah', '=hanukkah', '=chanukah', '=hanukah', '=chanukkah'],
  'new years eve': ['=nye', '=new years', 'new year', 'ball drop', 'countdown:0.5'],
  'nye': ['=new years eve', '=new years', 'new year', 'ball drop'],
  'new years': ['=new years eve', '=nye', 'new year'],
  'thanksgiving eve': ['=night before thanksgiving', 'drinksgiving', 'blackout wednesday'],
  'lunar new year': ['chinese new year', 'lion dance', 'seollal'],
  // outdoors, active, sports
  'hike': ['trail', 'guided hike', 'nature walk', 'walk:0.5'],
  'trail': ['hike', 'bike path:0.5'],
  'walk': ['nature walk', 'hike:0.6'],
  'run': ['5k', 'race', 'run club', 'turkey trot', 'parkrun', 'fun run', '10k'],
  '5k': ['run', 'race', 'turkey trot', 'parkrun', 'fun run'],
  'run club': ['run', 'parkrun', 'group run', '5k:0.5'],
  'pickleball': ['open play:0.4', 'paddle:0.5'],
  'yoga': ['pilates:0.4', 'meditation:0.4'],
  'ice skating': ['rink', 'public skate', 'public skating', 'skating'],
  'skating': ['ice skating', 'rink', 'public skate', 'roller skating:0.6'],
  'bowling': ['lanes'],
  'bike': ['ride', 'cycling', 'bike path'],
  'ride': ['bike', 'cycling'],
  'dog': ['dog friendly', 'pet friendly', 'dog park', 'pet', 'pup'],
  'dog friendly': ['dog', 'pet friendly', 'dog park:0.5'],
  'pet': ['dog', 'pet friendly'],
  'wheelchair': ['wheelchair accessible', 'accessible', 'step free', 'ada'],
  'accessible': ['wheelchair accessible', 'wheelchair', 'step free', 'ada'],
  'wheelchair accessible': ['accessible', 'wheelchair', 'step free', 'ada'],
  'free': ['no cover', 'free admission'],
  'cheap': ['budget', 'free'],
  'budget': ['cheap', 'free'],
  'beginner': ['beginner friendly', 'intro', 'all levels'],
  'football': ['nfl', 'giants', 'jets'],
  'watch party': ['sports bar', 'game day:0.5'],
  // arts
  'theater': ['=theatre', 'play', 'musical', 'broadway:0.5'],
  'musical': ['theater', '=theatre', 'broadway'],
  'movie': ['film', 'cinema', 'screening'],
  'film': ['movie', 'cinema', 'screening'],
  'museum': ['exhibit', 'gallery:0.5', 'history:0.5'],
  'show': ['concert', 'theater', '=theatre', 'comedy', 'live music', 'performance', 'musical', 'play'],
  'live show': ['=show', 'concert', 'theater', '=theatre', 'comedy', 'live music', 'performance', 'musical'],
  'performance': ['concert', 'theater', 'live music', 'show'],
  'market': ['craft fair', 'bazaar', 'vendors', 'farmers market', 'holiday market', 'boutique:0.5'],
  'craft fair': ['market', 'bazaar', 'vendors', 'handmade'],
  'festival': ['fest', 'street fair', 'fair:0.5'],
};

// Multi-word tags the harvest uses (research/HARVEST-BRIEF.md) so "paint and sip" or "story time"
// in a request is matched as one thing even before any row carries it.
const TAG_PHRASES = ['dance party', 'live music', 'cover band', 'open mic', 'day party', 'ladies night', 'speed dating',
  'line dancing', 'game night', 'hip hop', 'k pop', 'all ages', 'date night', 'beginner friendly', 'dog friendly',
  'late night', 'thanksgiving eve', 'black friday', 'new years eve', 'paint and sip', 'story time', 'wheelchair accessible',
  'happy hour', 'tree lighting', 'craft beer', 'wine bar', 'sports bar', 'ice skating', 'mini golf', 'laser tag',
  'bottle service', 'private rooms', 'karaoke rooms', 'board games', 'trivia night', 'farmers market', 'food trucks',
  'turkey trot', 'fun run', 'music bingo', 'stand up', 'classic rock', 'big band', 'indoor playground', 'dog park',
  'comedy club', 'book club', 'run club', 'supper club', 'social club', 'dance club', 'night club'];

// Too vague to search on by themselves. Dates come from the window, towns from town/near.
const STOP = new Set(words('a an the in on at for with and or of to from by near around about this that these those some any '
  + 'good great best fun cool nice new real actually really things thing something anything stuff do go going out place places '
  + 'spot spots event events night nights tonight today tomorrow weekend week month day days evening morning afternoon '
  + 'monday tuesday wednesday thursday friday saturday sunday bergen county nj jersey town area local nearby open now '
  + 'want need looking look find where what whats is are there here me my we us our i it not no like vibe type kind crowd '
  + 'people adult adults grown up coming soon upcoming happening going on live').filter(Boolean));

// A bare "club" means a nightclub. Matching the word itself would drag in every comedy club,
// run club and book club, so it is swapped before matching (those stay findable as phrases).
const MEANS = { club: 'nightclub' };

const key = (stems) => stems.join(' ');
const SYN = new Map();     // stem key -> [{ stems, w }]
const PHRASES = new Set(); // stem keys of known multi-word terms
for (const [head, list] of Object.entries(RELATED)) {
  const hs = words(head);
  if (hs.length > 1) PHRASES.add(key(hs));
  SYN.set(key(hs), list.map((raw) => {
    const same = raw.startsWith('=');
    const [term, w] = raw.replace(/^=/, '').split(':');
    const stems = words(term);
    if (stems.length > 1) PHRASES.add(key(stems));
    return { stems, w: same ? 1 : Number(w) || 0.7 };
  }));
}
for (const p of TAG_PHRASES) PHRASES.add(key(words(p)));

/**
 * Turn free text into concepts. Each concept is one thing the person asked for, with the
 * different ways a row could say it: [{ label, weight, alts: [{ stems, w }] }].
 * @param {string} text
 * @param {Set<string>} [extraPhrases]  stem keys of multi-word tags found in the data
 */
function parseQuery(text, extraPhrases, weight = 1) {
  const toks = words(text);
  const concepts = [];
  const seen = new Set();
  for (let i = 0; i < toks.length;) {
    let n = Math.min(4, toks.length - i);
    for (; n > 1; n--) {
      const k = key(toks.slice(i, i + n));
      if (PHRASES.has(k) || (extraPhrases && extraPhrases.has(k))) break;
    }
    let stems = toks.slice(i, i + n);
    i += n;
    if (n === 1 && MEANS[stems[0]]) stems = words(MEANS[stems[0]]);
    const k = key(stems);
    if ((n === 1 && (STOP.has(k) || k.length < 2)) || seen.has(k)) continue;
    seen.add(k);
    concepts.push({ label: k, weight, alts: [{ stems, w: 1 }, ...(SYN.get(k) || [])] });
  }
  return concepts;
}

// "mid 30s", "40+", "seniors", "singles" -> concepts matched against a row's crowd tags.
// Someone in their 40s also fits a 30+ night, so nearby age tags count for a bit less.
const AGE_LADDER = {
  '21+': ['21+'], '30+': ['30+', '40+:0.7', '21+:0.3'], '40+': ['40+', '30+:0.8', '50+:0.6'],
  '50+': ['50+', '40+:0.8', 'seniors:0.6'], '60+': ['seniors', '50+', '55+'],
};
const CROWD_WORDS = new Set(['singles', 'seniors', 'teens', 'toddlers', 'kids', 'family', 'children', 'date night', 'groups', 'lgbtq',
  'beginner', 'beginner friendly', 'dog friendly', 'wheelchair accessible', 'accessible', 'wheelchair', 'all ages', 'ladies night',
  'girls night', 'couples', 'baby'].map((t) => words(t).join(' ')));
function parseCrowd(text, extraPhrases) {
  const s = String(text || '').toLowerCase();
  const concepts = [];
  const ages = new Set();
  for (const m of s.matchAll(/\b(\d)\d\s*(?:s|\+|'s|-something|ish)?(?![\d$])/g)) {
    const decade = Number(m[1]);
    if (decade >= 2 && decade <= 9) ages.add(decade <= 2 ? '21+' : decade >= 6 ? '60+' : `${decade}0+`);
  }
  for (const a of ages) {
    concepts.push({ label: a, weight: 0.8, alts: AGE_LADDER[a].map((raw) => { const [t, w] = raw.split(':'); return { stems: words(t), w: Number(w) || 1 }; }) });
  }
  // Beyond ages, only words that name a crowd count ("not a college bar" must not match bars).
  const rest = s.replace(/\b\d\d\s*(?:s|\+|'s|-something|ish)?(?![\d$])/g, ' ');
  return [...concepts, ...parseQuery(rest, extraPhrases, 0.8).filter((c) => CROWD_WORDS.has(c.label))];
}

// Tags that say who something is for. Only these may be repeated as "who goes".
const CROWD_TAGS = new Set(['21+', '30+', '40+', '50+', '55+', 'all ages', 'kids', 'family', 'teens', 'seniors', 'toddlers', 'lgbtq',
  'singles', 'date night', 'groups', 'beginner friendly', 'dog friendly', 'wheelchair accessible', 'sensory friendly', 'ladies night']);

// Requirements ----------------------------------------------------------------

// Conditions a person has to meet before they can just show up. They usually sit in the last
// sentence of a description, which is the part a length cap cuts off, so they get their own field.
const REQ_TAGS = new Set(['registration required', 'residents only', 'rsvp', 'rsvp required', 'ticketed', 'sold out', 'members only',
  'reservations', 'reservations required', '18+', '21+', '30+', '40+', '50+', 'waiver required', 'cash only']);
const REQ_TEXT = new RegExp('\\b(?:regist\\w+|rsvp|reserv\\w+ (?:is |are )?(?:required|recommended|needed|suggested|a must)|reserve (?:a|your|ahead|online)|'
  + 'book (?:ahead|online|in advance|a slot|early)|residents? only|for \\w+ residents|must (?:be|bring|book|register|sign|wear|have|show)|required|'
  + 'in advance|sold out|rain (?:or snow )?(?:cancels|date)|weather permitting|payment (?:is )?due|pay(?:ment)? in full|deposit|'
  + 'ages? \\d+|grades? (?:\\d|k\\b)|\\d\\d\\+|(?:18|21) and (?:over|up|older)|waiver|members only|minimum|tell the front desk|'
  + 'limited (?:space|seating|capacity|spots)|first[- ]come|cash only|socks)\\b', 'i');

/**
 * What someone needs to know before going, in the row's own words.
 * @param {string[]} tags
 * @param {...string} texts  description and any other free text, untruncated
 * @returns {string[]}  requirement tags plus up to two sentences that state a condition
 */
function requirements(tags, ...texts) {
  const out = (tags || []).map((t) => String(t).toLowerCase()).filter((t) => REQ_TAGS.has(t));
  const said = [];
  for (const text of texts) {
    for (const raw of String(text || '').split(/(?<=[.!?])\s+|;\s+/)) {
      const sentence = raw.trim();
      if (sentence.length < 8 || !REQ_TEXT.test(sentence) || said.includes(sentence)) continue;
      said.push(sentence.length > 170 ? sentence.slice(0, 169) + '…' : sentence);
      if (said.length === 2) break;
    }
    if (said.length === 2) break;
  }
  // A tag the sentences already spell out doesn't need repeating.
  const low = said.join(' ').toLowerCase();
  return [...out.filter((t) => !low.includes(t.replace(/ required$/, ''))), ...said];
}

// Rows -----------------------------------------------------------------------

const hasSeq = (hay, needle) => {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

// Field weights: a tag or the title saying it beats a passing mention in the description.
const W = { tag: 6, tagPart: 4.5, title: 4, derived: 3.5, where: 2.5, extra: 2, about: 1.5 };

/**
 * Index one row for matching.
 * @param {{title?:string, tags?:string[], derivedTags?:string[], where?:string, extra?:string, about?:string}} f
 */
function indexRow(f) {
  return {
    tags: (f.tags || []).map(words).filter((t) => t.length),
    derived: (f.derivedTags || []).map(words).filter((t) => t.length),
    title: words(f.title),
    where: words(f.where),
    extra: words(f.extra),
    about: words(f.about),
  };
}

// Best field weight for one term in one indexed row (0 = not there).
function termWeight(ix, stems) {
  const k = key(stems);
  let best = 0;
  for (const t of ix.tags) {
    if (key(t) === k) return W.tag;
    if (best < W.tagPart && hasSeq(t, stems)) best = W.tagPart;
  }
  if (best < W.title && hasSeq(ix.title, stems)) best = W.title;
  if (best < W.derived && ix.derived.some((t) => hasSeq(t, stems))) best = W.derived;
  if (best < W.where && hasSeq(ix.where, stems)) best = W.where;
  if (best < W.extra && hasSeq(ix.extra, stems)) best = W.extra;
  if (best < W.about && hasSeq(ix.about, stems)) best = W.about;
  return best;
}

/**
 * Score an indexed row against concepts.
 * @returns {{score:number, matched:number, strong:boolean, literal:boolean, where:boolean, labels:string[]}}
 *   matched = how many concepts hit; strong = at least one hit above a description mention;
 *   literal = the word asked for (or a respelling of it) appears, not just a related word;
 *   where = a concept matched the venue/location (they asked for the place by name).
 */
function scoreRow(ix, concepts) {
  let score = 0;
  let matched = 0;
  let strong = false;
  let literal = false;
  let where = false;
  const labels = [];
  for (const c of concepts) {
    let best = 0;
    let bestRaw = 0;
    for (const a of c.alts) {
      const raw = termWeight(ix, a.stems);
      if (raw * a.w > best) { best = raw * a.w; bestRaw = raw; }
      if (raw && a.w === 1) literal = true;
    }
    if (!best) continue;
    matched++;
    labels.push(c.label);
    score += best * c.weight;
    if (bestRaw >= W.where) strong = true;
    if (hasSeq(ix.where, c.alts[0].stems)) where = true;
  }
  // A row that covers everything asked beats one that nails a single word.
  if (concepts.length > 1 && matched > 1) score += matched - 1;
  // A related word that only turns up in passing in a description ("run" for "run club") is not a match.
  if (!strong && !literal) return { score: 0, matched: 0, strong, literal, where, labels: [] };
  return { score, matched, strong, literal, where, labels };
}

// Schedules ------------------------------------------------------------------

const DAY_WORD = '(sun(?:days?)?|mon(?:days?)?|tue(?:s|sdays?)?|wed(?:s|nesdays?)?|thu(?:r|rs|rsdays?)?|fri(?:days?)?|sat(?:urdays?)?)';
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_DATE = '\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})\\b';
const RANGE_SEP = /^\s*(?:-|–|—|to|through|thru|until)\s*$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function dayRange(a, b) {
  const out = [];
  for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b || out.length > 7) break; }
  return out;
}

// Weekday mentions in order, with "Mon - Thu" style ranges expanded: [{ index, end, days:[..] }].
function dayTokens(text) {
  const re = new RegExp(`\\b${DAY_WORD}\\b`, 'gi');
  const hits = [...text.matchAll(re)].map((m) => ({ index: m.index, end: m.index + m[0].length, day: DAY_INDEX[m[1].slice(0, 3).toLowerCase()] }));
  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1];
    if (next && RANGE_SEP.test(text.slice(h.end, next.index).toLowerCase())) {
      out.push({ index: h.index, end: next.end, days: dayRange(h.day, next.day) });
      i++;
    } else out.push({ index: h.index, end: h.end, days: [h.day] });
  }
  // "Weekends" at a bar usually means Friday and Saturday nights, sometimes Sunday: counted as
  // all three and marked loose so the caller can say "confirm the day".
  const words2 = [[/\b(?:daily|every ?day|every night|nightly|7 days|365 days|seven days)\b/gi, ALL_DAYS],
    [/\bweekdays\b/gi, [1, 2, 3, 4, 5]], [/\bweekends?\b/gi, [5, 6, 0]]];
  for (const [rx, days] of words2) for (const m of text.matchAll(rx)) out.push({ index: m.index, end: m.index + m[0].length, days, loose: days.length === 3 });
  return out.sort((a, b) => a.index - b.index);
}

// Dates written out in a recurrence line ("Nov 13-15 and 19-21", "Dec 4, 5, 10", "Nov 22 - Dec 30")
// as YYYY-MM-DD, using the year that puts each one inside the row's own date range.
// filled = a range was expanded, so the list is "every day between" rather than dates someone listed.
function explicitDates(text, startsOn, endsOn) {
  const out = [];
  let filled = false;
  const lo = addDays(startsOn, -2);
  const hi = addDays(endsOn || startsOn, 2);
  const year = Number(startsOn.slice(0, 4));
  const resolve = (month, day) => {
    for (const y of [year, year + 1, year - 1]) {
      const ymd = `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (ymd >= lo && ymd <= hi) return ymd;
    }
    return null;
  };
  const add = (month, day) => { const d = resolve(month, day); if (d) out.push(d); };
  const notTime = '(?!\\s*(?::\\d|[ap]\\.?m|\\d))';
  const re = new RegExp(MONTH_DATE, 'gi');
  for (let m; (m = re.exec(text));) {
    // "listed through Dec 23" is where the listing stops, not a date it happens on.
    if (/(?:through|thru|until|till)\s*$/i.test(text.slice(0, m.index))) continue;
    const month = MONTHS[m[1].toLowerCase()];
    let last = Number(m[2]);
    let rest = text.slice(re.lastIndex);
    const cross = rest.match(new RegExp(`^\\s*(?:-|\\u2013|\\u2014|through|thru|to)\\s*${MONTH_DATE.replace('\\b', '')}`, 'i'));
    if (cross) {
      const from = resolve(month, last);
      const to = resolve(MONTHS[cross[1].toLowerCase()], Number(cross[2]));
      if (from && to) for (let d = from, n = 0; d <= to && n < 200; d = addDays(d, 1), n++) out.push(d);
      filled = true;
      re.lastIndex += cross[0].length;
      continue;
    }
    add(month, last);
    for (;;) {
      const range = rest.match(new RegExp(`^\\s*(?:-|\\u2013|\\u2014|through|thru)\\s*(\\d{1,2})\\b${notTime}`, 'i'));
      if (range) { for (let d = last + 1; d <= Number(range[1]) && d <= 31; d++) add(month, d); last = Number(range[1]); filled = true; rest = rest.slice(range[0].length); continue; }
      const more = rest.match(new RegExp(`^\\s*(?:,|&|and|,\\s*and)\\s*(\\d{1,2})\\b${notTime}`, 'i'));
      if (more) { last = Number(more[1]); add(month, last); rest = rest.slice(more[0].length); continue; }
      break;
    }
  }
  return { dates: [...new Set(out)].sort(), filled };
}

const ORDINALS = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, last: -1 };
const VAGUE = /\b(?:most|mostly|select|some|every other|alternat\w*|bi-?weekly|varies)\b/i;

/**
 * What a recurrence line means, or null when it can't be read:
 *   { type: 'weekly', days, nth?, unsure? }  on those weekdays (nth = only the 1st/2nd/... of the month)
 *   { type: 'dates', dates, unsure? }        on exactly those dates
 * unsure = the line hedges ("most days", "select Saturdays") and we filled in the pattern.
 */
function parseRecurrence(text, startsOn, endsOn) {
  if (!text || !startsOn) return null;
  // "Sun Nov 15" is a label on a date, not a weekly pattern ("Sundays, Nov 15 - Dec 20" is).
  const bare = text.replace(new RegExp(`\\b(?:sun|mon|tues?|wed|thur?s?|fri|sat)(?:day|sday|nesday|rsday|urday)?\\.?,?\\s+(?=(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d)`, 'gi'), '');
  const days = dayTokens(bare);
  const named = [...new Set(days.filter((d) => d.days.length < 7 && !/^week/i.test(bare.slice(d.index, d.end))).flatMap((d) => d.days))];
  const { dates, filled } = explicitDates(bare, startsOn, endsOn);
  const vague = VAGUE.test(text) || (days.length > 0 && days.every((d) => d.loose));
  // Listed dates win when they agree with the weekdays named ("Select Saturdays: Nov 21, Dec 19").
  // If they don't ("Mondays, Nov 16 - Dec 28"), the dates are just the span and the weekday is the pattern.
  if (dates.length && (!named.length || dates.every((d) => named.includes(weekday(d))))) {
    return { type: 'dates', dates, ...(vague && filled ? { unsure: true } : {}) };
  }
  if (!days.length) return null;
  const nth = [...new Set([...text.toLowerCase().matchAll(/\b(first|1st|second|2nd|third|3rd|fourth|4th|last)\b/g)].map((m) => ORDINALS[m[1]]))];
  return {
    type: 'weekly', days: [...new Set(days.flatMap((d) => d.days))],
    ...(nth.length && named.length ? { nth } : {}),
    ...(vague ? { unsure: true } : {}),
  };
}

// Is this date the 1st/2nd/.../last such weekday of its month?
function isNth(ymd, nth) {
  const day = Number(ymd.slice(8));
  if (nth.includes(Math.ceil(day / 7))) return true;
  return nth.includes(-1) && addDays(ymd, 7).slice(5, 7) !== ymd.slice(5, 7);
}

/**
 * The dates (YYYY-MM-DD) an event happens on between from and to, inclusive.
 * A weekly row only counts on its weekdays; a row with listed dates only on those dates.
 * @returns {{dates:string[], kind:'single'|'dates'|'weekly'|'daily'|'run'|'loose', unsure?:boolean}}
 *   'loose' = a long date range whose pattern we couldn't read (dates are "any day in the range").
 */
function occurrences(e, from, to) {
  if (!e.starts_on) return { dates: [], kind: 'single' };
  const last = e.ends_on && e.ends_on > e.starts_on ? e.ends_on : e.starts_on;
  const lo = from > e.starts_on ? from : e.starts_on;
  const hi = to < last ? to : last;
  if (lo > hi) return { dates: [], kind: last === e.starts_on ? 'single' : 'run' };
  if (last === e.starts_on) return { dates: [e.starts_on], kind: 'single' };
  // Some listings keep the weekdays in the time line ("Tue 10:30 AM, Fri 10 AM") and just say "Weekly".
  if (e._rec === undefined) {
    e._rec = parseRecurrence(e.recurrence_text, e.starts_on, last);
    if (!e._rec && e.time_text) {
      const days = [...new Set(dayTokens(e.time_text).flatMap((d) => d.days))];
      if (days.length && days.length < 7 && !new RegExp(MONTH_DATE, 'i').test(e.time_text)) e._rec = { type: 'weekly', days };
    }
  }
  const rec = e._rec;
  if (rec && rec.type === 'dates') {
    return { dates: rec.dates.filter((d) => d >= lo && d <= hi), kind: rec.dates.length > 8 ? 'daily' : 'dates', unsure: rec.unsure };
  }
  const dates = [];
  for (let d = lo, n = 0; d <= hi && n < 200; d = addDays(d, 1), n++) {
    if (!rec || (rec.days.includes(weekday(d)) && (!rec.nth || isNth(d, rec.nth)))) dates.push(d);
  }
  if (rec) return { dates, kind: rec.days.length === 7 ? 'daily' : 'weekly', unsure: rec.unsure };
  const span = Math.round((new Date(`${last}T12:00:00Z`) - new Date(`${e.starts_on}T12:00:00Z`)) / 86400e3);
  return { dates, kind: span <= 7 ? 'run' : 'loose' };
}

// Clock times --------------------------------------------------------------------

const T = '(\\d{1,2})(?::(\\d{2}))?\\s*(?:([ap])\\.?(?:m\\.?)?(?![a-z]))?';
const WORD_T = '(noon|midnight|close|closing)';

function toMinutes(h, m, ap) {
  h = Number(h); m = Number(m || 0);
  if (h > 12 || m > 59) return null;
  if (ap === 'a') return (h % 12) * 60 + m;
  if (ap === 'p') return (h % 12) * 60 + m + 720;
  return null;
}

// Every time or time range in a line of hours text, in order.
// -> [{ index, end, start, stop }] with stop null for a single time and Infinity for "until close".
function timeTokens(text) {
  const out = [];
  const used = [];
  const free = (i) => !used.some(([a, b]) => i >= a && i < b);
  const range = new RegExp(`\\b(?:${T}|${WORD_T})\\s*(?:-|\\u2013|\\u2014|to|until|till|'til)\\s*(?:${T}(?![\\d:])|${WORD_T})`, 'gi');
  for (const m of text.matchAll(range)) {
    const [, h1, m1, ap1raw, w1, h2, m2, ap2raw, w2] = m;
    let ap1 = ap1raw && ap1raw.toLowerCase();
    let ap2 = ap2raw && ap2raw.toLowerCase();
    let start = w1 ? (/noon/i.test(w1) ? 720 : /midnight/i.test(w1) ? 0 : null) : null;
    let stop = w2 ? (/noon/i.test(w2) ? 720 : /midnight/i.test(w2) ? 1440 : Infinity) : null;
    if (!w1 && !ap1 && !w2 && !ap2) continue;                 // "4-6": can't tell am from pm
    if (!w2 && !ap2) continue;
    if (!w2) stop = toMinutes(h2, m2, ap2);
    if (!w1) {
      if (!ap1) {                                              // "3-6pm", "10-4pm", "9 - close"
        ap1 = ap2 || 'p';
        start = toMinutes(h1, m1, ap1);
        if (stop !== Infinity && start !== null && start >= stop && ap2 === 'p') start = toMinutes(h1, m1, 'a');
      } else start = toMinutes(h1, m1, ap1);
    }
    if (start === null || stop === null) continue;
    if (stop !== Infinity && stop <= start) stop += 1440;      // runs past midnight
    out.push({ index: m.index, end: m.index + m[0].length, start, stop });
    used.push([m.index, m.index + m[0].length]);
  }
  const single = new RegExp(`\\b(?:(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?(?:m\\.?)?(?![a-z])|(noon|midnight))`, 'gi');
  for (const m of text.matchAll(single)) {
    if (!free(m.index)) continue;
    let at = m[4] ? (/noon/i.test(m[4]) ? 720 : 1440) : toMinutes(m[1], m[2], m[3].toLowerCase());
    if (at === null) continue;
    // "open until 1 AM", "closes at 11pm", or any lone time before 5 AM is when it ends, not when it starts.
    const closing = /(?:until|till|'?til|closes?(?: at)?|ends?(?: at)?|last (?:call|entry|admission)(?: at)?)\s*$/i.test(text.slice(0, m.index)) || at < 300;
    if (closing && at < 300) at += 1440;
    out.push(closing ? { index: m.index, end: m.index + m[0].length, until: at } : { index: m.index, end: m.index + m[0].length, start: at, stop: null });
  }
  for (const m of text.matchAll(/\ball day\b/gi)) out.push({ index: m.index, end: m.index + m[0].length, start: 0, stop: 1440 });
  for (const m of text.matchAll(/\bclosed\b/gi)) out.push({ index: m.index, end: m.index + m[0].length, closed: true });
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Read free-text hours or show times for one weekday (0 = Sunday).
 * @returns {null | {closed?:true, start?:number, stop?:number|null, starts?:number[]}}
 *   null = can't tell for that day. start/stop in minutes after midnight (stop > 1440 = past
 *   midnight, Infinity = "until close"); starts = single listed times when there is no range.
 */
function timesOn(text, dow) {
  if (!text) return null;
  const s = String(text);
  if (new RegExp(MONTH_DATE, 'i').test(s)) return null;        // times tied to listed dates: don't guess
  if (/\b\d{1,2}(?::\d{2})?\s*[-\u2013]\s*\d{1,2}(?::\d{2})?\b(?!\s*[ap]\.?m?\.?(?![a-z]))/i.test(s)) return null; // "4-6": am or pm?
  const toks = [...dayTokens(s).map((d) => ({ ...d, kind: 'day' })), ...timeTokens(s).map((t) => ({ ...t, kind: 'time' }))]
    .sort((a, b) => a.index - b.index);
  const times = toks.filter((t) => t.kind === 'time');
  if (!times.length) return null;
  const firstDay = toks.findIndex((t) => t.kind === 'day');
  const daysFirst = firstDay !== -1 && firstDay < toks.findIndex((t) => t.kind === 'time');
  const groups = [];
  let cur = null;
  let prev = null;
  for (const t of toks) {
    if (t.kind === 'day') {
      if (daysFirst) {
        // "Fri, Sat" or "Mon & Tues" is one group; days further apart start their own.
        const joined = prev && prev.kind === 'day' && /^[\s,&/]*(?:and|or)?[\s,]*$/i.test(s.slice(prev.end, t.index));
        if (joined && cur) cur.days.push(...t.days);
        else groups.push(cur = { days: [...t.days], times: [] });
      } else {
        if (!cur) groups.push(cur = { days: [], times: [] });
        (cur.days ||= []).push(...t.days);
        cur.dayed = true;
      }
    } else {
      if (!cur || (!daysFirst && cur.dayed)) groups.push(cur = { days: daysFirst || firstDay !== -1 ? [] : null, times: [] });
      cur.times.push(t);
    }
    prev = t;
  }
  const mine = groups.filter((g) => g.days === null || g.days.includes(dow)).flatMap((g) => g.times);
  if (!mine.length) return null;
  const ranges = mine.filter((t) => !t.closed && t.stop !== null && t.stop !== undefined);
  if (ranges.length) {
    // An "until 12am - 1am" style note reads as a range starting after midnight: too odd to trust.
    if (ranges.some((r) => r.start < 300 && !(r.start === 0 && r.stop === 1440))) return null;
    return { start: Math.min(...ranges.map((r) => r.start)), stop: Math.max(...ranges.map((r) => r.stop)) };
  }
  const starts = mine.filter((t) => t.start !== undefined).map((t) => t.start).sort((a, b) => a - b);
  const untils = mine.filter((t) => t.until !== undefined).map((t) => t.until);
  // "Kitchen opens 4:30 pm; bar closes 11pm" style: a start and a stop given separately.
  if (starts.length && untils.length && Math.max(...untils) > starts[0]) return { start: starts[0], stop: Math.max(...untils) };
  if (untils.length && !starts.length) return { until: Math.max(...untils) };
  if (starts.length) return { starts, start: starts[0], stop: null };
  // "Monday: Closed" counts; a stray "closed Thanksgiving" with no weekday doesn't.
  const closedToday = groups.some((g) => g.days && g.days.includes(dow) && g.times.length && g.times.every((t) => t.closed));
  return closedToday ? { closed: true } : null;
}

/**
 * Where an event stands at a given minute of its day.
 * @returns {null | {state:'over'|'on'|'later', text:string}}  null when the time isn't clear enough.
 */
function eventStatus(timeText, dow, nowMin, lateNight = false) {
  const t = timesOn(timeText, dow);
  if (!t || t.closed) return null;
  if (t.until !== undefined) return nowMin >= t.until ? { state: 'over', text: `ended at ${clockText(t.until)}` } : null;
  if (t.stop !== null && t.stop !== undefined) {
    if (t.stop !== Infinity && nowMin >= t.stop) return { state: 'over', text: `ended at ${clockText(t.stop)}` };
    if (nowMin >= t.start) return { state: 'on', text: t.stop === Infinity ? `started ${clockText(t.start)}, goes late` : `on now until ${clockText(t.stop)}` };
    return { state: 'later', text: `starts ${clockText(t.start)}` };
  }
  // Only start times are posted. Three hours after the last one, assume it has wrapped
  // (five for bar nights, which run late).
  const lastStart = t.starts[t.starts.length - 1];
  if (nowMin >= lastStart + (lateNight ? 300 : 180)) return { state: 'over', text: `started ${clockText(lastStart)}, almost certainly over` };
  // No end time posted: fine to walk into a bar night late, not a show that began 90 minutes ago.
  const stale = !lateNight && nowMin - t.start > 90;
  if (nowMin >= t.start) return { state: 'on', stale, text: `started ${clockText(t.start)}${stale ? ', probably well underway or over' : ''}` };
  return { state: 'later', text: `starts ${clockText(t.start)}` };
}

/**
 * Whether a place is open at a given minute, by its posted hours.
 * @returns {null | {open:boolean, text:string}}  null when the hours don't say.
 */
function openStatus(hoursText, dow, nowMin) {
  // Still open from last night? (e.g. 12:30 AM against "Fri 5pm - 2am")
  const y = timesOn(hoursText, (dow + 6) % 7);
  if (y && y.stop > 1440 && y.stop !== Infinity && nowMin < y.stop - 1440) return { open: true, text: `open now until ${clockText(y.stop)}` };
  const t = timesOn(hoursText, dow);
  if (!t) return null;
  if (t.closed) return { open: false, text: 'closed today' };
  if (t.until !== undefined && nowMin >= t.until) return { open: false, text: `closed for the night at ${clockText(t.until)}` };
  if (t.stop === null || t.stop === undefined) return null;
  if (nowMin < t.start) return { open: false, text: `not open yet, opens ${clockText(t.start)}` };
  if (t.stop === Infinity) return { open: true, text: 'open now, closing time not posted' };
  if (nowMin >= t.stop) return { open: false, text: `closed for the night at ${clockText(t.stop)}` };
  return { open: true, text: `open now until ${clockText(t.stop)}` };
}

// Holidays people ask for by name. If a short search window lands on one, rows tagged for it
// should lead even when the keyword didn't say so.
function holidayTerms(from, to) {
  const out = new Set();
  for (let d = from, n = 0; d <= to && n < 4; d = addDays(d, 1), n++) {
    const md = d.slice(5);
    const y = Number(d.slice(0, 4));
    if (md === '12-31' || md === '01-01') out.add('new years eve');
    if (md === '12-24' || md === '12-25') out.add('christmas');
    if (md === '10-31') out.add('halloween');
    if (md === '02-14') out.add('valentines');
    if (md === '03-17') out.add('st patricks');
    if (md === '07-04') out.add('fireworks');
    // Thanksgiving is the fourth Thursday of November; the night before is the big bar night.
    const nov1 = weekday(`${y}-11-01`);
    const thanksgiving = `${y}-11-${String(1 + ((4 - nov1 + 7) % 7) + 21).padStart(2, '0')}`;
    if (d === addDays(thanksgiving, -1)) out.add('thanksgiving eve');
    if (d === thanksgiving) out.add('thanksgiving');
    if (d === addDays(thanksgiving, 1)) out.add('black friday');
  }
  return [...out];
}

module.exports = {
  words, stem, parseQuery, parseCrowd, indexRow, scoreRow, requirements, CROWD_TAGS, W,
  parseRecurrence, occurrences, timesOn, eventStatus, openStatus, holidayTerms,
};
