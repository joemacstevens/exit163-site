// Work the follow-ups people are waiting on ("I'll find out and text you back").
// Spec: research/FOLLOWUP-SPEC.md. Research sees the question, never who asked.
//
//   node --env-file=.env.local scripts/followups.js list                 # what's waiting, soonest promise first
//   node --env-file=.env.local scripts/followups.js list drafted         # one status: open | drafted | approved | sent | closed | canceled
//   node --env-file=.env.local scripts/followups.js draft 12 --answer "Found out: ..." --source https://venue.example/event
//   node --env-file=.env.local scripts/followups.js draft 12 --not-found --answer "I dug into ... and couldn't confirm it. ..."
//   node --env-file=.env.local scripts/followups.js approve 12           # Joe's OK: it can now be sent
//   node --env-file=.env.local scripts/followups.js reject 12            # back to open; the promise still stands
//   node --env-file=.env.local scripts/followups.js send                 # dry run: shows what would go out
//   node --env-file=.env.local scripts/followups.js send 12 --live       # text it (8am-9pm NJ only)
//
// For the research routine (research/FOLLOWUP-ROUTINE.md):
//   node --env-file=.env.local scripts/followups.js research             # open questions as JSON, with sources worth checking
//   node --env-file=.env.local scripts/followups.js draft 12 --answer-file /path/to/answer.txt --source https://...
//   node --env-file=.env.local scripts/followups.js digest               # what the email to Joe would say
//   node --env-file=.env.local scripts/followups.js digest --send --note "..."   # email it, only if something needs him
//
// An answer needs the page it came from: the venue's or organizer's own page, or the ticket page,
// checked that day. Write it the way the buddy texts: plain, under 450 characters, opening by tying
// it to what they asked ("Found out: ...").
const fs = require('fs');
const path = require('path');
const followups = require('../lib/followups');
const { todayNJ, prettyDate, nowNJ } = require('../lib/dates');

const when = (iso) => { const d = new Date(iso); return `${prettyDate(todayNJ(d))} ${nowNJ(d).text}`; };
function show(r) {
  const late = followups.WAITING.includes(r.status) && r.due_at < new Date().toISOString() ? '  ** LATE **' : '';
  console.log(`#${r.id}  ${r.status}${late}  promised by ${when(r.due_at)}${r.needed_by ? `  (for ${r.needed_by})` : ''}${r.channel === 'test' ? '  [test]' : ''}`);
  console.log(`  ask:    ${r.question}${r.town_slug || r.category ? `  [${[r.town_slug, r.category].filter(Boolean).join(', ')}]` : ''}`);
  if (r.answer_text) console.log(`  ${r.found === false ? 'close: ' : 'answer:'} ${r.answer_text}  (${r.answer_text.length} chars)`);
  if (r.source_url) console.log(`  source: ${r.source_url}`);
}

// Registry sources (research/sources/REGISTRY.json) that could hold the answer to one question:
// sources the question names first, then the town's own calendar, then others in that town.
// They are leads for the routine, which still has to find the organizer's own page.
const COMMON = new Set(['bergen', 'county', 'events', 'event', 'calendar', 'holiday', 'holidays', 'public', 'library', 'center', 'official', 'municipal', 'borough', 'township', 'park', 'parks', 'north', 'south', 'east', 'west', 'home', 'year', 'week', 'weekly', 'first', 'last', 'show', 'shows', 'club', 'night', 'nights', 'tonight', 'this', 'that', 'with', 'from', 'jersey', 'schedule',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
function sourcesFor(row, limit = 6) {
  let all;
  try { all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'sources', 'REGISTRY.json'), 'utf8')).sources; }
  catch { return []; }
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const words = (t) => (String(t).toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !COMMON.has(w));
  // Words that are only a town's name ("Fair Lawn", "Park Ridge") say nothing about who runs an event.
  const townWords = new Set(all.flatMap((x) => x.towns || []).flatMap((t) => String(t).toLowerCase().match(/[a-z]+/g) || []));
  const asked = new Set(words(row.question).filter((w) => !townWords.has(w)));
  const seen = new Map();   // how many sources have each word in their name
  for (const x of all) for (const w of new Set(words(x.name))) seen.set(w, (seen.get(w) || 0) + 1);
  return all.filter((s) => s.access !== 'blocked').map((s) => {
    const inTown = Boolean(row.town_slug) && (s.towns || []).map(slug).includes(row.town_slug);
    const named = words(s.name).filter((w) => asked.has(w) && seen.get(w) <= 3).length;   // a word few sources share: "Saun", "bergenPAC", a venue's name
    const sameKind = Boolean(row.category) && (s.categories || []).includes(row.category);
    const official = ['town_calendar', 'county', 'venue_calendar'].includes(s.kind);
    let score = named * 5 + (inTown ? (s.kind === 'town_calendar' ? 6 : official && sameKind ? 3 : sameKind ? 1 : 0) : 0);
    if (s.kind === 'aggregator' && !named) score = 0;
    return { s, score };
  }).filter((x) => x.score >= 3).sort((x, y) => y.score - x.score).slice(0, limit)
    .map(({ s }) => ({ name: s.name, url: s.url, access: s.access, kind: s.kind, ...(s.notes ? { notes: String(s.notes).slice(0, 200) } : {}) }));
}

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const id = /^\d+$/.test(args[0] || '') ? Number(args[0]) : undefined;
  if (cmd === 'list') {
    const rows = await followups.list({ status: args.find((a) => /^[a-z]+$/.test(a)), includeTest: args.includes('--test') });
    if (!rows.length) return console.log('Nothing waiting.');
    rows.forEach((r) => { show(r); console.log(''); });
    return;
  }
  if (cmd === 'research') {
    const rows = await followups.forResearch({ includeTest: args.includes('--test') });
    return console.log(JSON.stringify(rows.map((r) => ({ ...r, sources: sourcesFor(r) })), null, 2));
  }
  if (cmd === 'digest') {
    const opts = { includeTest: args.includes('--test'), note: flag(args, 'note') };
    if (!args.includes('--send')) {
      const mail = followups.digestEmail(await followups.digest(opts), opts);
      return console.log(`Subject: ${mail.subject}\n\n${mail.text}\n\n(not emailed; add --send)`);
    }
    const out = await followups.sendDigest(opts);
    return console.log(`${out.sent ? 'Emailed Joe' : `No email (${out.why})`}: ${out.subject}\n\n${out.text}`);
  }
  if (cmd === 'draft' && id) {
    const file = flag(args, 'answer-file');   // saves shell quoting trouble with apostrophes and quotes
    const answer = file ? fs.readFileSync(file, 'utf8') : flag(args, 'answer');
    return show(await followups.draft(id, { answer, source: flag(args, 'source'), found: !args.includes('--not-found') }));
  }
  if (cmd === 'approve' && id) return show(await followups.approve(id));
  if (cmd === 'reject' && id) return show(await followups.reject(id));
  if (cmd === 'send') {
    const out = await followups.sendApproved({ id, dryRun: !args.includes('--live') });
    return console.log(JSON.stringify(out, null, 2));
  }
  console.log('Usage: followups.js list [status] | research | draft <id> --answer "..." | --answer-file <path> --source <url> [--not-found] | digest [--send] [--note "..."] | approve <id> | reject <id> | send [id] [--live]');
  process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { main, sourcesFor };
