// Offline test: the agent can only remember what the texter said in their own words.
// On 2026-11-15 a subscriber who had texted only her town, her name and her email ended up with
// "craft fairs and holiday markets" and "classical music" saved as interests: the agent's own two
// suggestions. No network, no model: lib/db.js and lib/agent.js are in-memory fakes; lib/memory.js is real.
//   node scripts/test-memory-grounding.js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- fakes ----------
const T = { sms_users: [], sms_messages: [], subscriber_facts: [] };
let nextId = 1;
function from(table) {
  const s = { op: 'select', filters: [], payload: null, one: false, sort: null };
  const hit = (r) => s.filters.every((f) => f(r));
  const run = () => {
    T[table] ||= [];
    if (s.op === 'insert') {
      const rows = s.payload.map((p) => ({ id: nextId++, created_at: new Date().toISOString(), ...p }));
      T[table].push(...rows);
      return { data: s.one ? { ...rows[0] } : rows.map((r) => ({ ...r })), error: null };
    }
    if (s.op === 'update') { T[table].filter(hit).forEach((r) => Object.assign(r, s.payload)); return { data: [], error: null }; }
    if (s.op === 'delete') { const gone = T[table].filter(hit); T[table] = T[table].filter((r) => !hit(r)); return { data: gone, error: null }; }
    const out = T[table].filter(hit);
    if (s.sort) out.sort((a, z) => (a[s.sort.col] < z[s.sort.col] ? -1 : a[s.sort.col] > z[s.sort.col] ? 1 : 0) * (s.sort.asc ? 1 : -1));
    return { data: s.one ? (out[0] ? { ...out[0] } : null) : out.map((r) => ({ ...r })), error: null };
  };
  const b = {
    select() { return b; },
    insert(p) { s.op = 'insert'; s.payload = Array.isArray(p) ? p : [p]; return b; },
    update(p) { s.op = 'update'; s.payload = p; return b; },
    delete() { s.op = 'delete'; return b; },
    eq(c, v) { s.filters.push((r) => r[c] === v); return b; },
    in(c, vs) { s.filters.push((r) => vs.includes(r[c])); return b; },
    gte() { return b; }, gt() { return b; }, limit() { return b; },
    order(col, o = {}) { s.sort ||= { col, asc: o.ascending !== false }; return b; }, // first order() wins, like the primary sort key
    maybeSingle() { s.one = true; return b; },
    single() { s.one = true; return b; },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}
const fake = (rel, exports) => { const f = require.resolve(path.join(ROOT, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
fake('lib/db.js', { db: () => ({ from }), q: async (p) => { const { data, error } = await p; if (error) throw new Error(`db: ${error.message}`); return data; } });
fake('lib/followups.js', { forContext: async () => [], describe: () => '', cancelOpen: async () => {}, forget: async () => {} });
// The model's part: on each turn it calls remember with whatever the test scripted, like the real one would.
let wantsToRemember = [];
let toolResult = null;
fake('lib/agent.js', {
  runBuddy: async ({ onRemember }) => {
    toolResult = wantsToRemember.length ? await onRemember(wantsToRemember) : null;
    return { reply: 'Here you go.', toolCalls: [] };
  },
});

const memory = require(path.join(ROOT, 'lib/memory.js'));
const { handleInbound } = require(path.join(ROOT, 'lib/conversation.js'));

const PHONE = '+15550100002';
const CRAFT_FAIR = "Hackensack, nice. Since it's already Sunday, here's an easy one: the Paramus Catholic Craft Fair is today, 10am-4pm. btw, what should I call you?";
const PIANO = 'Nice to meet you! If you want something calmer after the craft fair, the Piano Trio is today at 2:30pm at Forte Piano Music Company. Want the full weekend list in your inbox every Friday too? Just text me your email.';
function reset(earlier = []) {
  T.sms_users = [{ phone: PHONE, opted_out: false, town_slug: 'hackensack', prefs: {} }];
  T.sms_messages = earlier.map(([direction, body], i) => ({ phone: PHONE, direction, body, created_at: new Date(Date.now() - (earlier.length - i) * 60e3).toISOString() }));
  T.subscriber_facts = [];
  wantsToRemember = [];
  toolResult = null;
}
const text = async (body, items) => { wantsToRemember = items; await handleInbound({ phone: PHONE, text: body, channel: 'test', dryRunNewsletter: true }); };
const saved = () => T.subscriber_facts.map((f) => `${f.kind}: ${f.fact}`);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- the bug ----------
test('her town, name and email only: the agent\'s own suggestions are not saved as her interests', async () => {
  reset([['in', 'Join'], ['in', 'Hackensack'], ['out', CRAFT_FAIR], ['in', 'Keira'], ['out', PIANO]]);
  await text('kmd@example.com', [
    { kind: 'interest', fact: 'craft fairs and holiday markets' },
    { kind: 'interest', fact: 'classical music' },
  ]);
  assert.deepStrictEqual(saved(), []);
  assert.ok(/own words|they_said/i.test(JSON.stringify(toolResult.skipped || [])), 'the agent is told why');
});
test('quoting its own earlier reply does not make it something she said', async () => {
  reset([['in', 'Hackensack'], ['out', CRAFT_FAIR], ['in', 'Keira'], ['out', PIANO]]);
  await text('kmd@example.com', [
    { kind: 'interest', fact: 'craft fairs', they_said: 'Paramus Catholic Craft Fair' },
    { kind: 'interest', fact: 'classical music', they_said: 'the Piano Trio' },
  ]);
  assert.deepStrictEqual(saved(), []);
});

// ---------- what still has to work ----------
test('what they asked for in this text is saved', async () => {
  reset();
  await text('Festivals, fairs, live music, cideries, tag sales, comedy nights', [
    { kind: 'interest', fact: 'live music', they_said: 'live music' },
    { kind: 'interest', fact: 'comedy nights', they_said: 'comedy nights' },
    { kind: 'interest', fact: 'tag sales', they_said: 'Tag sales' },
  ]);
  assert.deepStrictEqual(saved(), ['interest: live music', 'interest: comedy nights', 'interest: tag sales']);
});
test('the fact can be reworded as long as the quote is theirs', async () => {
  reset();
  await text('Wyckoff but work in Paramus  love to go into the city', [
    { kind: 'interest', fact: 'trips into NYC', they_said: 'love to go into the city' },
    { kind: 'other', fact: 'works in Paramus', they_said: 'work in Paramus' },
  ]);
  assert.deepStrictEqual(saved(), ['interest: trips into NYC', 'other: works in Paramus']);
});
test('something they said earlier in the conversation counts', async () => {
  reset([['in', 'where can I dance bachata'], ['out', 'Try the Saturday Night Social at Havana Dance Center in Paramus.']]);
  await text('thanks!', [{ kind: 'interest', fact: 'bachata and Latin dancing', they_said: 'where can I dance bachata' }]);
  assert.deepStrictEqual(saved(), ['interest: bachata and Latin dancing']);
});
test('a warm reaction to a pick is their own words', async () => {
  reset([['in', 'Hackensack'], ['out', CRAFT_FAIR]]);
  await text('We went, loved the craft fair!', [{ kind: 'interest', fact: 'craft fairs', they_said: 'loved the craft fair' }]);
  assert.deepStrictEqual(saved(), ['interest: craft fairs']);
});
test('kids: saved when they mention them, not otherwise', async () => {
  reset();
  await text('Kids', [{ kind: 'kid', they_said: 'Kids' }]);
  assert.deepStrictEqual(saved(), ['kid: kid']);
  reset([['in', 'Hackensack'], ['out', 'The craft fair is free for kids under 12.']]);
  await text('ok', [{ kind: 'kid', kid_age: 8, they_said: 'kids under 12' }]);
  assert.deepStrictEqual(saved(), []);
});
test('a mixed batch keeps the said and drops the unsaid', async () => {
  reset([['in', 'date night ideas?'], ['out', 'Dracula at Bergen County Players, then dinner at Bar Mutz.']]);
  await text('sounds good', [
    { kind: 'interest', fact: 'date nights', they_said: 'date night ideas' },
    { kind: 'interest', fact: 'theater', they_said: 'Dracula at Bergen County Players' },
    { kind: 'food', fact: 'Italian' },
  ]);
  assert.deepStrictEqual(saved(), ['interest: date nights']);
});

// ---------- the check itself ----------
test('saidIt: forgiving about case, punctuation and order; strict about the words', () => {
  const theirs = ['Festivals, fairs, live music', "I don't eat meat"];
  assert.ok(memory.saidIt('live music', theirs));
  assert.ok(memory.saidIt('FAIRS & festivals', theirs));
  assert.ok(memory.saidIt('don’t eat meat', theirs), 'curly apostrophe');
  assert.ok(!memory.saidIt('classical music', theirs));
  assert.ok(!memory.saidIt('', theirs));
  assert.ok(!memory.saidIt(undefined, theirs));
  assert.ok(!memory.saidIt('i', theirs), 'too short to show anything');
  assert.ok(!memory.saidIt('live music', []));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
