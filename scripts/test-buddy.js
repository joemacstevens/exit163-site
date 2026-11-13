// Run scripted conversations through the real buddy (same code as the phone line) without Twilio.
// No texts are sent and no newsletter signups happen. Test data is deleted afterwards.
//   node --env-file=.env.local scripts/test-buddy.js            # all scenarios
//   node --env-file=.env.local scripts/test-buddy.js rainy-kids  # just some
//   HARVEST_OVERLAY=research/a.json,research/b.json node --env-file=.env.local scripts/test-buddy.js
//     test only: lets the search tools see research files that have not been imported yet
//     (merged in memory by lib/tools.js; nothing is written to the database for them)
//   SCENARIOS=scripts/scenarios-paces.json PHONE_BLOCK=030 RUN_LABEL=check  pick the script, phone block and file label
// Writes a transcript to research/test-runs/<timestamp>.md
const fs = require('fs');
const path = require('path');
const { handleInbound } = require('../lib/conversation');
const { db, q } = require('../lib/db');

const scenarios = require(process.env.SCENARIOS ? path.resolve(process.env.SCENARIOS) : './scenarios.json');
const only = process.argv.slice(2);
const picked = only.length ? scenarios.filter((s) => only.includes(s.id)) : scenarios;

(async () => {
  const outDir = path.join(__dirname, '..', 'research', 'test-runs');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let md = `# Buddy test run ${stamp}\n\n`;
  const phones = [];
  let n = 0;

  for (const s of picked) {
    const phone = `+1555${process.env.PHONE_BLOCK || "010"}${String(1000 + n++).slice(-4)}`;
    phones.push(phone);
    md += `## ${s.id}\n_${s.persona}_\n\n`;
    process.stdout.write(`${s.id} `);
    for (const text of s.turns) {
      const t = Date.now();
      let r;
      try { r = await handleInbound({ phone, text, channel: 'test', dryRunNewsletter: true, timeoutMs: 30000 }); }
      catch (e) { r = { reply: `ERROR: ${e.message}` }; }
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      const tools = (r.toolCalls || []).map((c) => `${c.name}(${JSON.stringify(c.input)})${c.ok ? '' : ' FAILED'}`).join(', ');
      md += `**Them:** ${text}\n\n**Exit 163** (${secs}s, ${r.reply ? r.reply.length : 0} chars${r.timedOut ? ', TIMED OUT' : ''}):\n${r.reply ? r.reply.split('\n').map((l) => '> ' + l).join('\n') : '> (no reply)'}\n\n`;
      if (tools) md += `<sub>tools: ${tools}</sub>\n\n`;
    }
    const [u] = await q(db().from('sms_users').select('first_name,town_slug,notes,email,blast_opt_in').eq('phone', phone));
    const facts = await q(db().from('subscriber_facts').select('kind,fact,born_year,source').eq('phone', phone));
    md += `<sub>profile after: ${JSON.stringify(u)}</sub>\n\n<sub>facts after: ${JSON.stringify(facts)}</sub>\n\n---\n\n`;
  }

  const file = path.join(outDir, `${stamp}${process.env.RUN_LABEL ? '-' + process.env.RUN_LABEL : ''}.md`);
  fs.writeFileSync(file, md);

  await q(db().from('sms_messages').delete().in('phone', phones));
  await q(db().from('sms_users').delete().in('phone', phones));
  await q(db().from('queries').delete().eq('channel', 'test'));
  // Research notes from test runs (the table may not exist yet; see db/migrations).
  await db().from('research_tickets').delete().eq('channel', 'test').then(() => {}, () => {});
  console.log(`\n${file}`);
})().catch((e) => { console.error(e); process.exit(1); });
