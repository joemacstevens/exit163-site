#!/usr/bin/env node
// Builds the editorial ad-landing articles in /read from holidays-2026.json.
//   node scripts/build-reads.js
// Dates, times and venues come from the data file, so re-run this after the tracker data changes.
// Hand-written copy lives in ARTICLES (hook, intro, section headlines) and in WHY / VENUE below;
// keep it in step with the data. The build fails if a WHY / VENUE key or a section no longer
// matches an event. Events without a 2026 date are left out of the articles.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVENTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'holidays-2026.json'), 'utf8'));

const ARTICLES = [
  {
    slug: 'ridgewood-glen-rock-holidays',
    area: 'Ridgewood area',
    title: 'Ridgewood, Glen Rock and nearby: 2026 tree and menorah lightings',
    h1: 'Ridgewood’s tree lighting is expected Fri, Dec 4 at 6 PM. Here’s what else is on nearby.',
    lede: 'Waldwick lights its menorah and its tree that same night. The week after brings Hanukkah in Ridgewood and Fair Lawn, two historic houses dressed for the season, and Wyckoff’s cookie walk.',
    match: (e) => ['Ridgewood', 'Glen Rock', 'Waldwick', 'Ho-Ho-Kus', 'Wyckoff', 'Fair Lawn'].includes(e.town),
    sections: [
      { h2: 'Fri, Dec 4', from: '2026-12-04', to: '2026-12-04' },
      { h2: 'Dec 5 to Dec 12', from: '2026-12-05', to: '2026-12-12' },
    ],
  },
  {
    slug: 'pascack-valley-holidays',
    area: 'Pascack Valley',
    title: 'Pascack Valley: 2026 tree and menorah lightings',
    h1: 'Westwood’s holiday parade and tree lighting is Sat, Dec 5 at 6 PM. Here’s every Pascack Valley lighting we found.',
    lede: 'After Westwood’s big night, Valley Chabad lights a menorah in seven towns across the valley from Dec 6 to Dec 8.',
    match: (e) => ['Westwood', 'Hillsdale', 'Montvale', 'Park Ridge', 'Emerson', 'Woodcliff Lake', 'Washington Township', 'River Vale'].includes(e.town),
    sections: [
      { h2: 'Sat, Dec 5', from: '2026-12-05', to: '2026-12-05' },
      { h2: 'Dec 6 to Dec 8: menorahs across the valley', from: '2026-12-06', to: '2026-12-08' },
    ],
  },
  {
    slug: 'paramus-river-edge-holidays',
    area: 'Paramus & River Edge',
    title: 'Paramus, River Edge and Oradell: 2026 holiday lightings',
    h1: 'Paramus’s Big Santa lighting is Sun, Nov 22 at 4 PM. Here’s what’s next near Paramus and River Edge.',
    lede: 'Winter Wonderland opens at Van Saun Park the day after Thanksgiving. In December there’s tea with Sinterklaas in River Edge, Oradell’s tree and menorah lighting, and a menorah at Bergen Town Center.',
    // County-run events count here only when they happen in Paramus (Van Saun Park).
    match: (e) => ['Paramus', 'River Edge', 'Oradell'].includes(e.town) || (e.town === 'Bergen County' && /Paramus/.test(e.location || '')),
    sections: [
      { h2: 'Sun, Nov 22', from: '2026-11-22', to: '2026-11-22' },
      { h2: 'Fri, Nov 27', from: '2026-11-27', to: '2026-11-27' },
      { h2: 'Dec 6 to Dec 10', from: '2026-12-06', to: '2026-12-10' },
    ],
  },
];

// EDITOR: one line on why each event is worth going to, keyed "town|event". Say only what the
// data's notes support; leave an event out of this list rather than invent a reason.
const RSVP = 'Free. RSVP on the Valley Chabad site.';
const WHY = {
  'Paramus|Big Santa Lighting at Westfield Garden State Plaza': 'Santa arrives by fire truck, then the 42-foot Big Santa lights up, with live music and fireworks. Free.',
  'Bergen County|Bergen County Winter Wonderland opens at Van Saun Park': 'The county’s holiday season, with Santa visits and a crafts market village.',
  'River Edge|Sinterklaas & Dutch Christmas Tea': 'A three-course Dutch colonial tea and a photo with Sinterklaas. $25 adults, $10 kids; reserve ahead.',
  'Oradell|Holiday Tree & Menorah Lighting': 'The tree and the menorah are lit together.',
  'Ridgewood|Downtown for the Holidays Tree Lighting (41st annual)': 'The Chamber’s downtown lighting, in its 41st year. Free.',
  'Waldwick|Annual Menorah Lighting': 'The first night of Hanukkah. Free.',
  'Waldwick|Annual Tree Lighting': 'Free.',
  'Wyckoff|Zabriskie House Holiday Tour': 'Wyckoff’s oldest home, decorated for the season, with music and lit fireplaces.',
  'Wyckoff|Grace Church Cookie Walk (10th annual)': 'Cookies by the pound ($13) until they sell out.',
  'Westwood|Home for the Holidays Parade & Tree Lighting': 'A parade through downtown, then the tree. Last year brought Santa and carolers too. Free.',
  'Montvale|Valley Chabad Menorah Lighting': RSVP,
  'Woodcliff Lake|Valley Chabad Menorah Lighting': RSVP,
  'Washington Township|Valley Chabad Menorah Lighting': RSVP,
  'River Vale|Menorah Lighting & Gelt Drop (Valley Chabad)': RSVP,
  'Park Ridge|Valley Chabad Menorah Lighting': RSVP,
  'Hillsdale|Valley Chabad Menorah Lighting': RSVP,
  'Westwood|Valley Chabad Menorah Lighting': RSVP,
};

// EDITOR: reader-facing venue where the data's location carries research notes. A venue taken
// from past years reads "Usually ...", never as this year's confirmed spot.
const VENUE = {
  'Ridgewood|Downtown for the Holidays Tree Lighting (41st annual)': 'Downtown Ridgewood',
  'Waldwick|Annual Menorah Lighting': 'Usually outside Waldwick Public Library',
  'Waldwick|Annual Tree Lighting': 'Usually Borough Park',
  'River Vale|Menorah Lighting & Gelt Drop (Valley Chabad)': 'Location sent after you RSVP',
};

const TYPE_LABEL = { tree: 'Tree lighting', menorah: 'Menorah lighting', market: 'Holiday market', santa: 'Santa', other: 'Holiday event' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`; };
const keyOf = (e) => `${e.town}|${e.event}`;
// Markup and classes follow the homepage (index.html): its ex- components plus .wrap, .nav, .kick, .lede, .foot.
const GLYPH = '<svg class="ex-glyph" viewBox="0 0 64 64" aria-hidden="true"><rect class="g-tile" width="64" height="64" rx="16"/><g class="g-lane" fill="none" stroke-width="6" stroke-linecap="round"><path d="M24 54V10"/><path d="M24 44c0-12 18-10 18-22"/></g><circle class="g-dot" cx="42" cy="12" r="5"/></svg>';
const WORDMARK = `<a class="ex-wordmark" href="/" aria-label="Exit163 home">${GLYPH}<span>exit<b>163</b></span></a>`;

// read.js tags past events by .ev[data-date] and appends to .when. Keep both.
function card(e) {
  // A date the organizer hasn't confirmed for 2026 reads "Expected <date>", never as certain.
  const date = `${e.verified_2026 ? '' : 'Expected '}${fmtDate(e.date)}`;
  const time = e.time ? e.time : /^All day/i.test(e.notes || '') ? 'All day' : 'Time TBA';
  const venue = VENUE[keyOf(e)] || e.location || 'Venue TBA';
  const why = WHY[keyOf(e)];
  return `<div class="ev t-${e.type}" data-date="${e.date}">
  <p class="when"><b>${date}</b> ${esc(time)}</p>
  <p class="what"><span>${esc(e.town === 'Bergen County' ? 'Paramus' : e.town)} &middot; ${TYPE_LABEL[e.type]}</span>${esc(e.event)}</p>
  <p class="where">${esc(venue)}</p>
  ${why ? `<p class="notes">${esc(why)}</p>` : ''}
</div>`;
}

// read.js finds these by form.sub, the form's first button, and the .msg beside it. Keep those three.
const form = (placement, h, p) => `<aside class="ex-join signup">
  <h2>${h}</h2>
  <p>${p}</p>
  <form class="sub ex-join__row" action="/api/subscribe" method="post" data-placement="${placement}">
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="sr">
    <div class="ex-field"><input id="${placement}-email" name="email" type="email" inputmode="email" required placeholder="you@email.com" autocomplete="email"><label for="${placement}-email">Your email</label></div>
    <button class="ex-btn ex-btn--primary" type="submit">Send me the Friday email <span class="ex-arrow" aria-hidden="true">&rarr;</span></button>
  </form>
  <p class="msg ex-join__err" role="status" aria-live="polite"></p>
</aside>`;

// Fail the build if hand-written copy points at an event that's no longer in the data.
for (const k of [...Object.keys(WHY), ...Object.keys(VENUE)]) {
  if (!EVENTS.some((e) => e.date && keyOf(e) === k)) throw new Error(`WHY/VENUE key matches no dated event: ${k}`);
}

function build(a) {
  const dated = EVENTS.filter((e) => a.match(e) && e.date).sort((x, y) => x.date.localeCompare(y.date) || x.town.localeCompare(y.town));

  const used = new Set();
  const sections = a.sections.map((s) => {
    const evs = dated.filter((e) => e.date >= s.from && e.date <= s.to);
    if (!evs.length) throw new Error(`${a.slug}: no events for section "${s.h2}"`);
    evs.forEach((e) => used.add(e));
    return `<section>\n<h2>${s.h2}</h2>\n${evs.map(card).join('\n')}\n</section>`;
  });
  const orphans = dated.filter((e) => !used.has(e));
  if (orphans.length) throw new Error(`${a.slug}: dated events not in any section: ${orphans.map((e) => `${e.town} ${e.date}`).join(', ')}`);

  const mid = Math.ceil(sections.length / 2); // the first signup sits about halfway through the events
  const article = `<p class="lede">${a.lede}</p>
${sections.slice(0, mid).join('\n')}
@@MIDFORM@@
${sections.slice(mid).join('\n')}
<p class="blurb">Details can change. Check with the host before you go.</p>`;

  // Read time from the article's own words (not the signup form), at 200 words a minute.
  const words = `${a.h1} ${article}`.replace(/<[^>]+>/g, ' ').replace('@@MIDFORM@@', ' ').split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  const body = article.replace('@@MIDFORM@@', form('mid', 'Get the weekend list every Friday', 'Every Friday at 7am we email the weekend’s things to do in Bergen County, each with its town and time. Free, one email a week.'));
  const url = `https://www.exit163.com/read/${a.slug}`;
  const desc = esc(a.lede.replace(/’/g, "'"));

  return {
    words,
    mins,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(a.title)} | Exit 163</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="https://www.exit163.com/og-image.png">
<meta name="theme-color" content="#f4f1ea">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/apple-touch-icon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/read.css">
<script src="/ga.js"></script><script src="/meta-pixel.js"></script>
</head>
<body>
<!-- Generated by scripts/build-reads.js from holidays-2026.json. Edit there, not here. -->
<header class="wrap read nav">
  ${WORDMARK}
  <nav aria-label="Primary"><a class="ex-btn ex-btn--secondary ex-btn--sm" href="/holidays">All of Bergen County <span class="ex-arrow" aria-hidden="true">&rarr;</span></a></nav>
</header>
<main class="wrap read">
<article data-article="${a.slug}">
<p class="kick">Holiday guide &middot; ${esc(a.area)}</p>
<h1>${a.h1}</h1>
<p class="meta"><b>${mins} min read</b></p>
${body}
</article>
${form('end', 'Get the weekend list every Friday', 'One email, 7am Friday: what’s on in Bergen County that weekend, with town and time on every pick. Free. Unsubscribe anytime.')}
<p class="more">Looking for another town? See the <a href="/holidays">Bergen County holiday tracker</a>.</p>
</main>
<footer>
  <div class="wrap read foot">
    ${WORDMARK}
    <nav aria-label="Footer"><a href="/claim">For businesses</a><a href="/#mcp">Your own AI</a><a href="/holidays">Holiday tracker</a><a href="https://www.instagram.com/exit.163/" target="_blank" rel="noopener">Instagram</a><a href="/privacy">Privacy</a></nav>
    <p>&copy; 2026 Exit163 · Made in Bergen County, for people who'd rather be out than scrolling.</p>
  </div>
</footer>
<script src="/read.js"></script>
</body>
</html>
`,
  };
}

fs.mkdirSync(path.join(ROOT, 'read'), { recursive: true });
for (const a of ARTICLES) {
  const { html, words, mins } = build(a);
  fs.writeFileSync(path.join(ROOT, 'read', `${a.slug}.html`), html);
  console.log(`read/${a.slug}.html  ${words} words, ${mins} min read`);
}
