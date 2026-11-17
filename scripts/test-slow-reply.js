// Offline test for slow turns: when the agent misses Twilio's window, the texter gets a short
// holding text right away and the real answer as a second text once it is ready.
// No network, no database, no texts: lib/db.js, lib/agent.js and the sender are in-memory fakes.
//   node scripts/test-slow-reply.js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- the same tiny in-memory Supabase stand-in as scripts/test-followups.js ----------
const T = {};
let seq = 0;
const stamp = () => new Date(Date.now() + ++seq).toISOString();
const DEFAULTS = {
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

// The fake agent: each test sets how long the "model" takes and what it returns.
let script = async () => ({ reply: 'ok', toolCalls: [] });
let lastCall = null;
fake('lib/agent.js', { runBuddy: async (p) => { lastCall = p; return script(p); } });

const { handleInbound, HOLD_REPLY, SLOW_REPLY, LATE_FAIL_REPLY } = require('../lib/conversation');

const PHONE = '+15550100001';
const WINDOW = 40;   // ms: stands in for the 12 seconds Twilio waits
const LATE = 400;    // ms: stands in for the longer budget once the holding text is out
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answerAfter = (ms, out) => async () => { await sleep(ms); return { toolCalls: [], ...out }; };
const reset = () => { for (const k of Object.keys(T)) delete T[k]; script = async () => ({ reply: 'ok', toolCalls: [] }); lastCall = null; };
// A late sender like api/sms.js builds: records texts and the promises it is asked to keep alive.
const lateBox = ({ failSend = false } = {}) => {
  const box = { sent: [], kept: [] };
  box.late = {
    send: async (body) => { if (failSend) throw new Error('Twilio 400: nope'); box.sent.push(body); return 'SMlate'; },
    keepAlive: (p) => { box.kept.push(p); },
  };
  box.settle = () => Promise.all(box.kept);
  return box;
};
const outTexts = () => (T.sms_messages || []).filter((m) => m.direction === 'out').map((m) => m.body);
const text = (body, late, extra = {}) => handleInbound({ phone: PHONE, text: body, channel: 'sms', dryRunNewsletter: true, timeoutMs: WINDOW, lateMs: LATE, late, ...extra });
const quiet = (fn) => async (...a) => { const { warn, error } = console; console.warn = console.error = () => {}; try { return await fn(...a); } finally { console.warn = warn; console.error = error; } };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a fast answer goes back inline, with nothing kept alive and nothing sent later', async () => {
  reset();
  const box = lateBox();
  script = answerAfter(5, { reply: 'McFaul Environmental Center in Wyckoff is free and indoors.' });
  const r = await text('Anything indoors Saturday?', box.late);
  assert.strictEqual(r.reply, 'McFaul Environmental Center in Wyckoff is free and indoors.');
  assert.strictEqual(box.kept.length, 0);
  assert.strictEqual(box.sent.length, 0);
});

test('a slow answer: holding text now, the real answer as a second text once it is ready', async () => {
  reset();
  const box = lateBox();
  script = answerAfter(WINDOW + 60, { reply: 'McFaul Environmental Center in Wyckoff is free and indoors.' });
  const t = Date.now();
  const r = await text('Anything indoors Saturday?', box.late);
  assert.ok(Date.now() - t < WINDOW + 30, 'the webhook answers inside the window');
  assert.strictEqual(r.reply, HOLD_REPLY);
  assert.strictEqual(box.kept.length, 1);
  assert.strictEqual(box.sent.length, 0, 'nothing else is sent before the answer is ready');
  await box.settle();
  assert.deepStrictEqual(box.sent, ['McFaul Environmental Center in Wyckoff is free and indoors.']);
  assert.deepStrictEqual(outTexts(), [HOLD_REPLY, 'McFaul Environmental Center in Wyckoff is free and indoors.'], 'both texts are in the history, in order');
});

test('with a late sender the agent gets the longer budget; without one it keeps the short one', async () => {
  // Production numbers; the fake agent answers at once, so nothing waits on them.
  const real = (late) => handleInbound({ phone: PHONE, text: 'hi', channel: 'sms', dryRunNewsletter: true, timeoutMs: 12000, lateMs: 45000, late });
  reset();
  await real(lateBox().late);
  assert.ok(lastCall.deadlineMs > 12000 && lastCall.deadlineMs < 45000, `deadline ${lastCall.deadlineMs} should be past the window, inside the late budget`);
  reset();
  await real(undefined);
  assert.ok(lastCall.deadlineMs < 12000, `deadline ${lastCall.deadlineMs} should be inside the window`);
});

test('no late sender (test harness, other channels): the old holding text and nothing more', async () => {
  reset();
  script = answerAfter(WINDOW + 60, { reply: 'too late' });
  const r = await text('Anything indoors Saturday?', undefined);
  assert.strictEqual(r.reply, SLOW_REPLY);
  await sleep(WINDOW + 80);
  assert.deepStrictEqual(outTexts(), [SLOW_REPLY]);
});

test('if the longer budget runs out too, the promised text back still comes: a short apology', async () => {
  reset();
  const box = lateBox();
  script = answerAfter(WINDOW + 20, { reply: null, timedOut: true });
  await text('Anything indoors Saturday?', box.late);
  await box.settle();
  assert.deepStrictEqual(box.sent, [LATE_FAIL_REPLY]);
  assert.deepStrictEqual(outTexts(), [HOLD_REPLY, LATE_FAIL_REPLY]);
});

test('if the agent throws after the holding text, the apology goes out and nothing is left unhandled', quiet(async () => {
  reset();
  const box = lateBox();
  script = async () => { await sleep(WINDOW + 20); throw new Error('overloaded'); };
  await text('Anything indoors Saturday?', box.late);
  await box.settle();
  assert.deepStrictEqual(box.sent, [LATE_FAIL_REPLY]);
}));

test('if the late send fails, it is not logged as said and the kept promise still resolves', quiet(async () => {
  reset();
  const box = lateBox({ failSend: true });
  script = answerAfter(WINDOW + 20, { reply: 'McFaul is free.' });
  await text('Anything indoors Saturday?', box.late);
  await box.settle();
  assert.deepStrictEqual(outTexts(), [HOLD_REPLY]);
}));

test('a late honest miss still leaves a research ticket, like an inline one', async () => {
  reset();
  const box = lateBox();
  script = answerAfter(WINDOW + 20, { reply: "I haven't heard of a science event this Saturday.", toolCalls: [{ name: 'search_events', input: { keyword: 'science', near: 'Park Ridge' } }] });
  await text('Science stuff Saturday?', box.late);
  assert.strictEqual((T.research_tickets || []).length, 0, 'no ticket while the answer is still coming');
  await box.settle();
  await sleep(5);
  assert.strictEqual(T.research_tickets.length, 1);
  assert.strictEqual(T.research_tickets[0].summary, 'Science stuff Saturday?');
});

test('a late answer keeps the search digest for the next text, like an inline one', async () => {
  reset();
  const box = lateBox();
  script = answerAfter(WINDOW + 20, { reply: 'McFaul is free.', lookups: [{ kind: 'place', name: 'McFaul Environmental Center', town: 'Wyckoff' }] });
  await text('Anything indoors Saturday?', box.late);
  assert.ok(!T.sms_users[0].prefs?.recent, 'nothing saved while the answer is still coming');
  await box.settle();
  assert.ok(T.sms_users[0].prefs?.recent, 'digest saved once the answer is in');
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
