#!/usr/bin/env node
// Builds the editorial ad-landing articles in /read from holidays-2026.json.
//   node scripts/build-reads.js
// Every date, time, venue, note and source link on the page is copied from the data file, so
// re-run this after the tracker data changes. The only hand-written copy is in ARTICLES below
// (hook, standfirst, section headlines); keep it in step with the data, and the build fails if a
// headline's section or a "short version" pick no longer matches any event.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVENTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'holidays-2026.json'), 'utf8'));
// EDITOR: the day the data was last checked against its sources (same as LAST_UPDATED in holidays.html).
const LAST_CHECKED = '2026-11-12';

const ARTICLES = [
  {
    slug: 'ridgewood-glen-rock-holidays',
    area: 'Ridgewood area',
    title: 'Ridgewood, Glen Rock and nearby: 2026 tree and menorah lightings',
    h1: 'Ridgewood’s tree lighting is listed for Fri, Dec 4 at 6 PM. Here’s every other one near you.',
    lede: 'One catch: Ridgewood’s date comes from a county roundup that doesn’t state the year, so we mark it unconfirmed. Waldwick’s two lightings the same night are on the borough calendar. Glen Rock and Ho-Ho-Kus haven’t posted 2026 dates yet.',
    match: (e) => ['Ridgewood', 'Glen Rock', 'Waldwick', 'Ho-Ho-Kus', 'Wyckoff', 'Fair Lawn'].includes(e.town),
    short: ['Ridgewood|Downtown for the Holidays Tree Lighting (41st annual)', 'Waldwick|Annual Menorah Lighting', 'Waldwick|Annual Tree Lighting', 'Fair Lawn|Community Menorah Lighting at Borough Hall'],
    sections: [
      { h2: 'Fri, Dec 4: Ridgewood at 6 PM, Waldwick at 4:30 and 7 PM', from: '2026-12-04', to: '2026-12-04' },
      { h2: 'Dec 5 to Dec 12: Hanukkah in Ridgewood and Fair Lawn, two holiday house days, Wyckoff’s cookie walk', from: '2026-12-05', to: '2026-12-12' },
    ],
    tbaH2: 'No 2026 date yet: Glen Rock, Ho-Ho-Kus and Wyckoff’s tree lightings',
  },
  {
    slug: 'pascack-valley-holidays',
    area: 'Pascack Valley',
    title: 'Pascack Valley: 2026 tree and menorah lightings',
    h1: 'Westwood’s holiday parade and tree lighting is Sat, Dec 5 at 6 PM. Here’s every Pascack Valley lighting we could find.',
    lede: 'Westwood’s night is on the borough calendar. After it, Valley Chabad lists seven menorah lightings across the valley from Dec 6 to Dec 8. Hillsdale, Montvale and Park Ridge haven’t posted 2026 tree lighting dates yet.',
    match: (e) => ['Westwood', 'Hillsdale', 'Montvale', 'Park Ridge', 'Emerson', 'Woodcliff Lake', 'Washington Township', 'River Vale'].includes(e.town),
    short: ['Westwood|Home for the Holidays Parade & Tree Lighting', 'Montvale|Valley Chabad Menorah Lighting', 'River Vale|Menorah Lighting & Gelt Drop (Valley Chabad)', 'Hillsdale|Valley Chabad Menorah Lighting'],
    sections: [
      { h2: 'Sat, Dec 5: Westwood’s parade and tree lighting at 6 PM', from: '2026-12-05', to: '2026-12-05' },
      { h2: 'Dec 6 to Dec 8: seven menorah lightings in three nights', from: '2026-12-06', to: '2026-12-08' },
    ],
    tbaH2: 'No 2026 date yet: tree lightings in Hillsdale, Montvale and Park Ridge',
  },
  {
    slug: 'paramus-river-edge-holidays',
    area: 'Paramus & River Edge',
    title: 'Paramus, River Edge and Oradell: 2026 holiday lightings',
    h1: 'Paramus’s Big Santa lighting is Sun, Nov 22 at 4 PM. Here’s what’s next near Paramus and River Edge.',
    lede: 'The Big Santa lighting is on the Garden State Plaza site for 4 to 6 PM. Winter Wonderland at Van Saun Park opens Fri, Nov 27, and its hours aren’t posted yet. Paramus and River Edge haven’t posted their own tree lightings.',
    // County-run events count here only when they happen in Paramus (Van Saun Park).
    match: (e) => ['Paramus', 'River Edge', 'Oradell'].includes(e.town) || (e.town === 'Bergen County' && /Paramus/.test(e.location || '')),
    short: ['Paramus|Big Santa Lighting at Westfield Garden State Plaza', 'Bergen County|Bergen County Winter Wonderland opens at Van Saun Park', 'Oradell|Holiday Tree & Menorah Lighting', 'Paramus|Menorah Lighting at Bergen Town Center'],
    sections: [
      { h2: 'Sun, Nov 22: the Big Santa lighting at Garden State Plaza, 4 to 6 PM', from: '2026-11-22', to: '2026-11-22' },
      { h2: 'Fri, Nov 27: Winter Wonderland opens at Van Saun Park. Hours aren’t posted yet', from: '2026-11-27', to: '2026-11-27' },
      { h2: 'Dec 6 to Dec 10: Sinterklaas in River Edge, Oradell’s tree and menorah, a menorah at Bergen Town Center', from: '2026-12-06', to: '2026-12-10' },
    ],
    tbaH2: 'No 2026 date yet: tree lightings in River Edge, at Paramus Borough Hall and at Van Saun Park',
  },
];

const TYPE_LABEL = { tree: 'Tree lighting', menorah: 'Menorah lighting', market: 'Holiday market', santa: 'Santa', other: 'Holiday event' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`; };
const host = (url) => new URL(url).hostname.replace(/^www\./, '');
const source = (e) => `<a class="src" href="${esc(e.source_url)}" target="_blank" rel="noopener">Source: ${esc(host(e.source_url))}</a>`;
const why = (e, label) => (e.verify_note ? `<details><summary>${label}</summary><p>${esc(e.verify_note)}</p></details>` : '');
const status = (e) => (e.verified_2026 ? '<span class="tag ok">2026 date confirmed</span>' : '<span class="tag warn">Date not yet confirmed</span>');

function card(e) {
  // Say what's missing once: skip our placeholder when the event's own notes already cover it.
  const notes = e.notes || '';
  const time = e.time ? esc(e.time) : /^All day/i.test(notes) ? 'All day' : '<i>Time not posted yet</i>';
  const where = [e.location ? esc(e.location) : /venue/i.test(notes) ? '' : '<i>Venue not posted yet</i>', e.cost ? esc(e.cost) : ''].filter(Boolean).join(' &middot; ');
  return `<div class="ev t-${e.type}" data-date="${e.date}">
  <p class="when"><b>${fmtDate(e.date)}</b> ${time}</p>
  <p class="what"><span>${esc(e.town)} &middot; ${TYPE_LABEL[e.type]}</span>${esc(e.event)}</p>
  ${where ? `<p class="where">${where}</p>` : ''}
  ${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}
  <p class="foot">${status(e)} ${source(e)}</p>
  ${why(e, e.verified_2026 ? 'How we confirmed it' : 'Why unconfirmed?')}
</div>`;
}

function tbaRow(e) {
  return `<div class="ev tba t-${e.type}">
  <p class="what"><span>${esc(e.town)} &middot; ${TYPE_LABEL[e.type]}</span>${esc(e.event)}</p>
  <p class="where"><b>Last held:</b> ${e.last_seen ? esc(e.last_seen) : 'not found'}${e.location ? ` &middot; ${esc(e.location)}` : ''}</p>
  ${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}
  <p class="foot"><span class="tag warn">No 2026 date yet</span> ${source(e)}</p>
  ${why(e, 'Why no date yet?')}
</div>`;
}

const form = (placement, h, p) => `<aside class="signup">
  <h2>${h}</h2>
  <p>${p}</p>
  <form class="sub" action="/api/subscribe" method="post" data-placement="${placement}">
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="sr">
    <input type="email" name="email" required placeholder="you@email.com" aria-label="Email address" autocomplete="email">
    <button type="submit">Send me the Friday email</button>
  </form>
  <p class="msg" role="status" aria-live="polite"></p>
</aside>`;

function build(a) {
  const mine = EVENTS.filter(a.match);
  const dated = mine.filter((e) => e.date).sort((x, y) => x.date.localeCompare(y.date) || x.town.localeCompare(y.town));
  const tba = mine.filter((e) => !e.date).sort((x, y) => x.town.localeCompare(y.town));

  const used = new Set();
  const sections = a.sections.map((s) => {
    const evs = dated.filter((e) => e.date >= s.from && e.date <= s.to);
    if (!evs.length) throw new Error(`${a.slug}: no events for section "${s.h2}"`);
    evs.forEach((e) => used.add(e));
    return `<section>\n<h2>${s.h2}</h2>\n${evs.map(card).join('\n')}\n</section>`;
  });
  const orphans = dated.filter((e) => !used.has(e));
  if (orphans.length) throw new Error(`${a.slug}: dated events not in any section: ${orphans.map((e) => `${e.town} ${e.date}`).join(', ')}`);

  const short = a.short.map((key) => {
    const e = dated.find((x) => `${x.town}|${x.event}` === key);
    if (!e) throw new Error(`${a.slug}: short-version pick not found in data: ${key}`);
    return `<li><b>${fmtDate(e.date)}${e.time ? ` &middot; ${esc(e.time)}` : ''}</b> ${esc(e.town === 'Bergen County' ? '' : `${e.town}: `)}${esc(e.event)}${e.verified_2026 ? '' : ' <em>(not yet confirmed)</em>'}</li>`;
  });
  short.push(`<li><b>Not announced</b> ${tba.length} more listings near you are still waiting on a 2026 date. They’re at the bottom, with the last date we found as a guide.</li>`);

  const mid = Math.ceil(sections.length / 2); // the first signup sits about halfway through the dated events
  const [, cm, cd] = LAST_CHECKED.split('-').map(Number);
  const checked = `${MONTHS[cm - 1]} ${cd}`;
  const body = `<p class="lede">${a.lede}</p>
<aside class="callout">
  <h2>The short version</h2>
  <ul>
${short.join('\n')}
  </ul>
</aside>
${sections.slice(0, mid).join('\n')}
${form('mid', 'Towns are still posting dates', 'We keep checking, and every Friday at 7am we email the weekend’s things to do in Bergen County, each with its town and time. Free, one email a week.')}
${sections.slice(mid).join('\n')}
<aside class="callout">
  <h2>How to read the tags</h2>
  <p><span class="tag ok">2026 date confirmed</span> means the organizer or an official listing shows this year’s date. <span class="tag warn">Date not yet confirmed</span> means we found a date, but the listing doesn’t state the year. Tap “Why unconfirmed?” for the detail, and check the source before you go.</p>
</aside>
<section>
<h2>${a.tbaH2}</h2>
<p class="blurb">Nobody has posted a 2026 date for these yet. “Last held” is the most recent date we found. It’s a guide only, not this year’s date.</p>
${tba.map(tbaRow).join('\n')}
</section>`;

  // Read time from the visible words (the tap-to-open notes don't count), at 200 words a minute.
  const words = `${a.h1} ${body}`.replace(/<details>[\s\S]*?<\/details>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  const url = `https://www.exit163.com/read/${a.slug}`;
  const desc = esc(a.lede.replace(/’/g, "'"));

  return `<!doctype html>
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
<meta name="theme-color" content="#0B0D10">
<link rel="icon" type="image/png" href="/avatar.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Overpass:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/read.css">
<script src="/meta-pixel.js"></script>
</head>
<body>
<!-- Generated by scripts/build-reads.js from holidays-2026.json. Edit there, not here. -->
<header class="top">
  <a class="brand" href="/" aria-label="Exit 163 home"><span class="shield" aria-hidden="true"><small>EXIT</small><b>163</b></span></a>
  <a class="all" href="/holidays">All of Bergen County &rarr;</a>
</header>
<main>
<article data-article="${a.slug}">
<p class="kicker">Holiday guide &middot; ${esc(a.area)}</p>
<h1>${a.h1}</h1>
<p class="meta"><b>${mins} min read</b> &middot; Dates checked ${checked} &middot; Every listing links to its source</p>
${body}
</article>
${form('end', 'Get the weekend list every Friday', 'One email, 7am Friday: what’s on in Bergen County that weekend, with town and time on every pick. Free. Unsubscribe anytime.')}
<p class="more">Looking for another town? Every listing we have is in the <a href="/holidays">Bergen County holiday tracker</a>.</p>
</main>
<footer>
  <p>Exit 163 is a free guide to what to do in Bergen County, NJ. <a href="/">Home</a> &middot; <a href="https://www.instagram.com/exit.163/" target="_blank" rel="noopener">@exit.163</a> &middot; <a href="/privacy">Privacy</a></p>
</footer>
<script src="/read.js"></script>
</body>
</html>
`;
}

fs.mkdirSync(path.join(ROOT, 'read'), { recursive: true });
for (const a of ARTICLES) {
  fs.writeFileSync(path.join(ROOT, 'read', `${a.slug}.html`), build(a));
  console.log(`read/${a.slug}.html`);
}
