// Thursday step: write one personal line per subscriber for this week's issue (lib/issue.json).
//   node --env-file=.env.local scripts/personal-picks.js                       # preview only
//   node --env-file=.env.local scripts/personal-picks.js --write               # save for the Friday text
//   node --env-file=.env.local scripts/personal-picks.js --write --email       # also set the email line in Resend
//   ... --out ../newsletter/2026-11-20/personal-picks.md                       # save the preview for review
// Texts: /api/blast with "issue_date" puts each saved line on top of that person's Friday text.
// Email: sets the Resend contact property personal_pick (cleared for anyone without a line),
// which the issue template shows in a "Picked for you" box via {{{personal_pick|fallback}}}.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { db, q } = require('../lib/db');
const memory = require('../lib/memory');
const { personalLine } = require('../lib/personalize');

const args = process.argv.slice(2);
const write = args.includes('--write');
const email = args.includes('--email');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const RESEND_BIN = process.env.RESEND_BIN || path.join(process.env.HOME, '.resend/bin/resend');
const mask = (p) => p.slice(0, -4).replace(/\d/g, '•') + p.slice(-4);

(async () => {
  delete require.cache[require.resolve('../lib/issue.json')];
  const issue = require('../lib/issue.json');
  if (!issue?.text || !issue?.date) throw new Error('lib/issue.json has no issue; run the issue build first');

  const users = await q(db().from('sms_users').select('phone,first_name,town_slug,email,notes,blast_opt_in,opted_out'));
  const reachable = users.filter((u) => !u.opted_out && (u.blast_opt_in || u.email));
  const rows = [];
  for (let i = 0; i < reachable.length; i += 4) {
    rows.push(...await Promise.all(reachable.slice(i, i + 4).map(async (u) => {
      const facts = await memory.loadFacts(u.phone);
      const townName = memory.townName(u.town_slug);
      const summary = memory.summarize({ firstName: u.first_name, townName, facts });
      if (u.notes) summary.push(`notes: ${u.notes}`); // not yet sorted into facts by the nightly review
      const hasSignal = facts.length > 0 || townName || u.notes;
      const r = hasSignal
        ? await personalLine({ issueText: issue.text, firstName: u.first_name, townName, summary }).catch((e) => ({ line: '', fit: `error: ${e.message}` }))
        : { line: '', fit: 'nothing remembered' };
      return { u, summary, ...r };
    })));
  }

  let md = `# Personal picks for the ${issue.date} issue\n\nEach line goes on top of that person's Friday text, and in the "Picked for you" box of their email. People with no line get the normal text and the generic box.\n\n`;
  for (const r of rows) {
    md += `- **${mask(r.u.phone)}**${r.u.first_name ? ` (${r.u.first_name})` : ''}: ${r.line ? `"${r.line}"` : '_no personal line_'}\n  - knows: ${r.summary.join('; ') || 'nothing'}\n  - why: ${r.fit || '-'}\n`;
  }
  const withLine = rows.filter((r) => r.line);
  md += `\n${withLine.length} of ${rows.length} reachable subscribers get a personal line.\n`;
  console.log(md);
  if (outFile) fs.writeFileSync(outFile, md);

  if (write) {
    await q(db().from('personal_picks').delete().eq('issue_date', issue.date));
    if (withLine.length) await q(db().from('personal_picks').insert(withLine.map((r) => ({ issue_date: issue.date, phone: r.u.phone, line: r.line }))));
    console.log(`saved ${withLine.length} lines for ${issue.date}`);
  }

  if (email) {
    let set = 0;
    for (const r of rows.filter((x) => x.u.email)) {
      try {
        execFileSync(RESEND_BIN, ['contacts', 'update', r.u.email, '-q', '--properties', JSON.stringify({ personal_pick: r.line || null })], { stdio: 'pipe' });
        set++;
      } catch (e) {
        console.error(`resend update failed for ${mask(r.u.phone)}: ${String(e.stderr || e.message).slice(0, 200)}`);
      }
    }
    console.log(`updated the email line on ${set} Resend contacts`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
