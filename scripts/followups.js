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
// An answer needs the page it came from: the venue's or organizer's own page, or the ticket page,
// checked that day. Write it the way the buddy texts: plain, under 450 characters, opening by tying
// it to what they asked ("Found out: ...").
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
  if (cmd === 'draft' && id) return show(await followups.draft(id, { answer: flag(args, 'answer'), source: flag(args, 'source'), found: !args.includes('--not-found') }));
  if (cmd === 'approve' && id) return show(await followups.approve(id));
  if (cmd === 'reject' && id) return show(await followups.reject(id));
  if (cmd === 'send') {
    const out = await followups.sendApproved({ id, dryRun: !args.includes('--live') });
    return console.log(JSON.stringify(out, null, 2));
  }
  console.log('Usage: followups.js list [status] | draft <id> --answer "..." --source <url> [--not-found] | approve <id> | reject <id> | send [id] [--live]');
  process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { main };
