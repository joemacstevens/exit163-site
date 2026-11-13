// Offline test for follow-ups ("I'll find out and text you back"). No network, no database, no
// texts: lib/db.js and lib/agent.js are replaced with in-memory fakes.
//   node scripts/test-followups.js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- a tiny in-memory stand-in for the Supabase client ----------
const T = {};                 // table name -> rows
const missing = new Set();    // tables that "don't exist yet"
let seq = 0;
const stamp = () => new Date(Date.now() + ++seq).toISOString();   // strictly increasing, like real rows
const DEFAULTS = {
  followups: () => ({ id: ++seq, status: 'open', channel: 'sms', found: null, answer_text: null, source_url: null, sent_at: null, needed_by: null, created_at: stamp() }),
  research_tickets: () => ({ id: ++seq, status: 'new', created_at: stamp() }),
  sms_messages: () => ({ id: ++seq, created_at: stamp() }),
  sms_users: () => ({ opted_out: false, blast_opt_in: false, town_slug: null, first_name: null, notes: null, email: null, prefs: {}, newsletter_opt_in_at: null }),
};

function from(table) {
  const rows = () => (T[table] ||= []);
  const s = { op: 'select', filters: [], payload: null, returning: false, one: false, limit: null, orders: [], cols: null };
  const pick = (r) => (s.cols ? Object.fromEntries(s.cols.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r });
  const hit = (r) => s.filters.every((f) => f(r));
  const add = (f) => { s.filters.push(f); return b; };
  const run = () => {
    if (missing.has(table)) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
    if (s.op === 'insert') {
      const made = s.payload.map((p) => { const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...p }; rows().push(row); return row; });
      return { data: s.returning ? (s.one ? pick(made[0]) : made.map(pick)) : null, error: null };
    }
    if (s.op === 'update') { const m = rows().filter(hit); m.forEach((r) => Object.assign(r, s.payload)); return { data: s.returning ? m.map(pick) : null, error: null }; }
    if (s.op === 'delete') { T[table] = rows().filter((r) => !hit(r)); return { data: null, error: null }; }
    let out = rows().filter(hit);
    for (const [c, asc] of s.orders) out = [...out].sort((x, y) => (x[c] > y[c] ? 1 : x[c] < y[c] ? -1 : 0) * (asc ? 1 : -1));
    if (s.limit != null) out = out.slice(0, s.limit);
    if (s.one) return { data: out[0] ? pick(out[0]) : null, error: null };
    return { data: out.map(pick), error: null };
  };
  const b = {
    select(cols) { if (s.op !== 'select') s.returning = true; if (cols && cols !== '*') s.cols = cols.split(',').map((c) => c.trim()); return b; },
    insert(p) { s.op = 'insert'; s.payload = Array.isArray(p) ? p : [p]; return b; },
    update(p) { s.op = 'update'; s.payload = p; return b; },
    delete() { s.op = 'delete'; return b; },
    eq: (c, v) => add((r) => r[c] === v),
    in: (c, vs) => add((r) => vs.includes(r[c])),
    lte: (c, v) => add((r) => r[c] != null && r[c] <= v),
    gte: (c, v) => add((r) => r[c] != null && r[c] >= v),
    gt: (c, v) => add((r) => r[c] != null && r[c] > v),
    order(c, o = {}) { s.orders.push([c, o.ascending !== false]); return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    single() { s.one = true; return b; },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}

const fake = (rel, exports) => { const f = require.resolve(path.join(ROOT, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
fake('lib/db.js', { db: () => ({ from }), q: async (p) => { const { data, error } = await p; if (error) throw new Error(`db: ${error.message}`); return data; } });

// The real prompts, read (with the fake database already in place) before the agent is faked.
const realAgent = require('../lib/agent');

// The fake agent: each test sets what the "model" does with the callbacks it is handed.
let script = async () => ({ reply: 'ok', toolCalls: [] });
let lastProfile = null;
fake('lib/agent.js', { runBuddy: async (p) => { lastProfile = p.profile; return script(p); } });

const followups = require('../lib/followups');
const { handleInbound } = require('../lib/conversation');
const { hourNJ } = require('../lib/dates');

const PHONE = '+15550100001';
const OTHER = '+15550100002';
const DAY = new Date('2026-11-13T15:00:00Z');     // Friday 10:00am in NJ
const NIGHT = new Date('2026-11-14T03:00:00Z');   // Friday 10:00pm in NJ
const ASK = 'Is the Oradell tree lighting on Dec 5 still on if it rains?';
const quiet = (fn) => async (...a) => { const { warn, error } = console; console.warn = console.error = () => {}; try { return await fn(...a); } finally { console.warn = warn; console.error = error; } };

function reset({ on = true } = {}) {
  for (const k of Object.keys(T)) delete T[k];
  missing.clear();
  process.env.FOLLOWUPS = on ? 'on' : '';
  T.sms_users = [{ ...DEFAULTS.sms_users(), phone: PHONE }, { ...DEFAULTS.sms_users(), phone: OTHER }];
  script = async () => ({ reply: 'ok', toolCalls: [] });
  lastProfile = null;
}
const make = (over = {}) => followups.create({ phone: PHONE, question: ASK, town: 'Oradell', category: 'holiday', ...over }, DAY);
async function approved(over = {}) {
  const f = await make(over);
  await followups.draft(f.id, { answer: 'Found out: the Oradell tree lighting moves inside to the firehouse if it rains. Same time, Saturday 5pm, free.', source: 'https://www.oradell.org/tree-lighting' });
  await followups.approve(f.id);
  return f.id;
}
const row = (id) => T.followups.find((r) => r.id === id);
const count = (table) => (T[table] || []).length;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- the switch ----------

test('with follow-ups off, the prompt is the old one and nothing can be promised', async () => {
  reset({ on: false });
  assert.ok(realAgent.SYSTEM.includes('Never promise to text them later'));
  assert.ok(!realAgent.SYSTEM.includes('text you back'));
  assert.ok(!/\[\[/.test(realAgent.SYSTEM + realAgent.SYSTEM_FOLLOWUPS));
  assert.ok(realAgent.SYSTEM_FOLLOWUPS.includes('Want me to find out and text you back?'));
  assert.ok(!realAgent.SYSTEM_FOLLOWUPS.includes('Never promise to text them later'));
  const out = await make();
  assert.strictEqual(out.ok, false);
  assert.strictEqual(count('followups') + count('research_tickets'), 0);
  assert.deepStrictEqual(await followups.forContext(PHONE), { open: [], sent: [] });
});

test('if the table is not there yet, the buddy is told to make no promise and nothing breaks', quiet(async () => {
  reset();
  missing.add('followups');
  const out = await make();
  assert.strictEqual(out.ok, false);
  assert.match(out.reason, /Don't promise/);
  assert.deepStrictEqual(await followups.forContext(PHONE), { open: [], sent: [] });
  await followups.cancelOpen(PHONE);
  await followups.forget(PHONE);
  await followups.prune();
}));

// ---------- making the promise ----------

test('a yes creates one follow-up, due 8pm NJ the next day, linked to an anonymous ticket', async () => {
  reset();
  const out = await make();
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.promise, 'by tomorrow night');
  const f = row(out.id);
  assert.strictEqual(f.due_at, '2026-11-15T01:00:00.000Z');           // Sat Nov 14, 8pm EST
  assert.strictEqual(hourNJ(new Date(f.due_at)), 20);
  assert.strictEqual(f.town_slug, 'oradell');
  assert.strictEqual(f.agreed_at, DAY.toISOString());
  const [t] = T.research_tickets;
  assert.strictEqual(f.ticket_id, t.id);
  assert.strictEqual(t.kind, 'gap');
  assert.ok(!JSON.stringify(t).includes('555'), 'the ticket must not carry the phone number');
  assert.ok(!('phone' in t));
});

test('the promise time is 8pm NJ in summer too', async () => {
  assert.strictEqual(followups.dueAt(new Date('2026-07-01T15:00:00Z')), '2026-07-03T00:00:00.000Z');   // Thu Jul 2, 8pm EDT
});

test('contact details never reach the question or the ticket', async () => {
  reset();
  const out = await make({ question: 'Find out if DJ Rico plays Friday, text me at 201-555-0199 or rico@example.com' });
  const saved = row(out.id).question + JSON.stringify(T.research_tickets);
  assert.ok(!/0199|example\.com/.test(saved));
});

test('no promise when they need it sooner than we can find out', async () => {
  reset();
  for (const needed_by of ['2026-11-13', '2026-11-14']) {
    const out = await make({ needed_by });
    assert.strictEqual(out.ok, false);
    assert.match(out.reason, /sooner/);
  }
  assert.strictEqual(count('followups'), 0);
  assert.strictEqual((await make({ needed_by: '2026-11-15' })).ok, true);
});

test('two open follow-ups per person is the cap; someone else is unaffected', async () => {
  reset();
  assert.ok((await make()).ok && (await make({ question: 'Is Santa at Van Saun sold out for Dec 12?' })).ok);
  const third = await make({ question: 'What time does the Ridgewood menorah lighting start?' });
  assert.strictEqual(third.ok, false);
  assert.strictEqual(T.followups.length, 2);
  assert.strictEqual((await make({ phone: OTHER })).ok, true);
});

// ---------- what the buddy is told ----------

test('the context lists what is owed and what was just sent, and drops old answers', async () => {
  reset();
  const a = await make();
  const sentId = await approved({ question: 'Is Santa at Van Saun sold out for Dec 12?' });
  await followups.sendApproved({ dryRun: false, send: async () => {}, now: DAY });
  let text = followups.describe(await followups.forContext(PHONE));
  assert.match(text, new RegExp(`follow-up id ${a.id}`));
  assert.match(text, /Don't promise it again/);
  assert.match(text, /you texted them this follow-up/);
  assert.match(text, /firehouse/);
  assert.match(text, /oradell\.org/);
  row(sentId).sent_at = new Date(Date.now() - 80 * 3600e3).toISOString();
  text = followups.describe(await followups.forContext(PHONE));
  assert.ok(!/firehouse/.test(text));
  assert.strictEqual(followups.describe({ open: [], sent: [] }), '');
});

test('the context says when they cannot have another one', async () => {
  reset();
  await make(); await make({ question: 'Is Santa at Van Saun sold out for Dec 12?' });
  assert.match(followups.describe(await followups.forContext(PHONE)), /don't offer another/);
});

test('the buddy can close its own follow-up, not someone else\'s', async () => {
  reset();
  const a = await make();
  assert.deepStrictEqual(await followups.close(OTHER, a.id), { closed: false });
  assert.deepStrictEqual(await followups.close(PHONE, a.id), { closed: true });
  assert.strictEqual(row(a.id).status, 'closed');
  assert.strictEqual((await followups.forContext(PHONE)).open.length, 0);
});

// ---------- research and approval ----------

test('research never sees who asked, and test rows stay out of the list', async () => {
  reset();
  await make(); await make({ phone: OTHER, channel: 'test' });
  const rows = await followups.list();
  assert.strictEqual(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes('555'));
  assert.strictEqual((await followups.list({ includeTest: true })).length, 2);
});

test('a draft needs a source, plain text and a sane length; an honest close needs no source', async () => {
  reset();
  const a = await make();
  await assert.rejects(followups.draft(a.id, { answer: 'Found out: it moves inside.' }), /source/);
  await assert.rejects(followups.draft(a.id, { answer: 'Found out: it moves inside.', source: 'the borough told me' }), /source/);
  await assert.rejects(followups.draft(a.id, { answer: '**Found out:** it moves inside.', source: 'https://x.example/a' }), /plain text/);
  await assert.rejects(followups.draft(a.id, { answer: 'x'.repeat(751), source: 'https://x.example/a' }), /751 characters/);
  assert.strictEqual(row(a.id).status, 'open');
  const d = await followups.draft(a.id, { answer: "I dug into the Oradell tree lighting and couldn't confirm a rain plan.", found: false });
  assert.strictEqual(d.status, 'drafted');
  assert.strictEqual(d.found, false);
  assert.ok(!('phone' in d));
});

test('reject sends a draft back to open; the promise still stands', async () => {
  reset();
  const id = await approved();
  const r = await followups.reject(id);
  assert.strictEqual(r.status, 'open');
  assert.strictEqual(row(id).answer_text, null);
  await assert.rejects(followups.approve(id), /no draft/);
  assert.strictEqual((await followups.forContext(PHONE)).open.length, 1);
});

// ---------- sending ----------

test('a dry run shows the text and sends nothing', async () => {
  reset();
  const id = await approved();
  let calls = 0;
  const out = await followups.sendApproved({ send: async () => { calls++; }, now: DAY });
  assert.strictEqual(out.dry_run, true);
  assert.strictEqual(out.ready.length, 1);
  assert.strictEqual(out.ready[0].to, '+•••••••0001');
  assert.strictEqual(calls, 0);
  assert.strictEqual(row(id).status, 'approved');
});

test('only approved answers go out: open and drafted ones wait', async () => {
  reset();
  await make();
  const b = await make({ question: 'Is Santa at Van Saun sold out for Dec 12?' });
  await followups.draft(b.id, { answer: 'Found out: sold out.', source: 'https://x.example/a' });
  const sent = [];
  const out = await followups.sendApproved({ dryRun: false, send: async (to, body) => sent.push([to, body]), now: DAY });
  assert.strictEqual(out.sent, 0);
  assert.strictEqual(sent.length, 0);
});

test('nothing goes out during quiet hours', async () => {
  reset();
  const id = await approved();
  let calls = 0;
  const out = await followups.sendApproved({ dryRun: false, send: async () => { calls++; }, now: NIGHT });
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /Quiet hours/);
  assert.strictEqual(calls, 0);
  assert.strictEqual(row(id).status, 'approved');
});

test('an approved answer is texted once, logged in the chat, and never sent again', async () => {
  reset();
  const id = await approved();
  const sent = [];
  const send = async (to, body) => sent.push([to, body]);
  const [one, two] = await Promise.all([
    followups.sendApproved({ dryRun: false, send, now: DAY }),
    followups.sendApproved({ dryRun: false, send, now: DAY }),
  ]);
  const three = await followups.sendApproved({ dryRun: false, send, now: DAY });
  assert.strictEqual(sent.length, 1, 'two runs at once must not both send');
  assert.strictEqual(one.sent + two.sent + three.sent, 1);
  assert.strictEqual(sent[0][0], PHONE);
  assert.match(sent[0][1], /^Found out:/);
  assert.strictEqual(row(id).status, 'sent');
  assert.ok(row(id).sent_at);
  assert.deepStrictEqual(T.sms_messages.map((m) => [m.phone, m.direction, m.body]), [[PHONE, 'out', sent[0][1]]]);
});

test('opted-out numbers and test rows are never texted', async () => {
  reset();
  const gone = await approved();
  const testRow = await approved({ phone: OTHER, channel: 'test' });
  T.sms_users.find((u) => u.phone === PHONE).opted_out = true;
  let calls = 0;
  const out = await followups.sendApproved({ dryRun: false, send: async () => { calls++; }, now: DAY });
  assert.strictEqual(calls, 0);
  assert.strictEqual(out.sent, 0);
  assert.strictEqual(row(gone).status, 'canceled');
  assert.strictEqual(row(testRow).status, 'approved');
  assert.deepStrictEqual(out.skipped.map((s) => s.why).sort(), ['opted out', 'test row']);
});

test('if the text fails to send, the answer stays approved and the next run sends it once', async () => {
  reset();
  const id = await approved();
  const bad = await followups.sendApproved({ dryRun: false, send: async () => { throw new Error('Twilio 500: nope'); }, now: DAY });
  assert.strictEqual(bad.sent, 0);
  assert.strictEqual(bad.failed.length, 1);
  assert.ok(!JSON.stringify(bad).includes('5550100001'), 'phones are masked in the result');
  assert.strictEqual(row(id).status, 'approved');
  assert.strictEqual(count('sms_messages'), 0);
  const sent = [];
  await followups.sendApproved({ dryRun: false, send: async (to, body) => sent.push(body), now: DAY });
  assert.strictEqual(sent.length, 1);
});

test('old finished follow-ups are pruned; waiting ones never are', async () => {
  reset();
  const keep = await make();
  const done = await approved({ question: 'Is Santa at Van Saun sold out for Dec 12?' });
  await followups.sendApproved({ dryRun: false, send: async () => {}, now: DAY });
  const old = new Date(Date.now() - 40 * 86400e3).toISOString();
  row(keep.id).created_at = old; row(done).created_at = old;
  await followups.prune();
  assert.deepStrictEqual(T.followups.map((r) => r.id), [keep.id]);
});

// ---------- through the conversation (lib/conversation.js) ----------

const text = (body, phone = PHONE) => handleInbound({ phone, text: body, channel: 'sms', dryRunNewsletter: true });
const callFollowUp = async (p) => { const out = await p.onFollowUp({ question: ASK, town: 'Oradell' }); return { reply: out.ok ? `On it. I'll text you ${out.promise}.` : 'Check back Thursday.', toolCalls: [{ name: 'follow_up', ok: out.ok }], out }; };

test('the buddy cannot promise a text back unless it offered and they said yes', async () => {
  reset();
  script = callFollowUp;
  const r = await text('is the oradell tree lighting still on if it rains saturday?');
  assert.strictEqual(r.reply, 'Check back Thursday.');
  assert.strictEqual(count('followups'), 0, 'no follow-up without consent');
});

test('offer, then yes: the follow-up is created and the next turn knows about it', async () => {
  reset();
  script = async () => ({ reply: "I haven't heard either way. Want me to find out and text you back?", toolCalls: [] });
  await text('is the oradell tree lighting still on if it rains dec 5?');
  script = callFollowUp;
  const r = await text('yes pls');
  assert.match(r.reply, /I'll text you by tomorrow night/);
  assert.strictEqual(T.followups.length, 1);
  assert.strictEqual(T.followups[0].phone, PHONE);
  script = async () => ({ reply: 'Still on it!', toolCalls: [] });
  await text('any word?');
  assert.strictEqual(lastProfile.offeredFollowUp, true);
  assert.match(lastProfile.followUpsText, /Oradell tree lighting/);
});

test('asking outright ("find out and text me") counts as the yes', async () => {
  reset();
  script = callFollowUp;
  await text('can you find out if the oradell tree lighting is on dec 5 and text me?');
  assert.strictEqual(T.followups.length, 1);
});

test('a reply to a sent answer reaches the buddy with what was sent', async () => {
  reset();
  await approved();
  await followups.sendApproved({ dryRun: false, send: async () => {}, now: DAY });
  await text('what time again?');
  assert.match(lastProfile.followUpsText, /you texted them this follow-up/);
  assert.match(lastProfile.followUpsText, /Saturday 5pm/);
});

test('STOP cancels what is owed; FORGET deletes their questions', async () => {
  reset();
  await make(); await make({ phone: OTHER });
  await text('STOP');
  assert.strictEqual(T.followups.find((r) => r.phone === PHONE).status, 'canceled');
  assert.strictEqual(T.followups.find((r) => r.phone === OTHER).status, 'open');
  await text('FORGET', OTHER);
  assert.ok(!T.followups.some((r) => r.phone === OTHER));
  assert.strictEqual(T.followups.length, 1);
});

test('with follow-ups off, the conversation carries on exactly as before', async () => {
  reset({ on: false });
  script = callFollowUp;
  T.sms_messages = [{ ...DEFAULTS.sms_messages(), phone: PHONE, direction: 'in', body: 'hi' }, { ...DEFAULTS.sms_messages(), phone: PHONE, direction: 'out', body: 'Want me to find out and text you back?' }];
  const r = await text('yes');
  assert.strictEqual(r.reply, 'Check back Thursday.');
  assert.strictEqual(count('followups'), 0);
  assert.strictEqual(lastProfile.followUpsText, '');
  await text('FORGET');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok    ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e.stack || e).split('\n').slice(0, 4).join('\n      ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
