// Offline test for deals. No network, no database, no texts: lib/db.js and lib/agent.js are
// replaced with in-memory fakes.
//   node scripts/test-deals.js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- a tiny in-memory stand-in for the Supabase client ----------
const T = {};                 // table name -> rows
const touched = [];           // every table a query named, in order
let failing = false;          // make every query fail
let seq = 0;
const DEFAULTS = {
  deals: () => ({ id: `deal-${++seq}`, status: 'active', starts_on: require('../lib/dates').todayNJ(), ends_on: null, terms: null, first_time_only: false, redemption_cap: null }),
  deal_offers: () => ({ created_at: new Date().toISOString(), last_shown_at: new Date().toISOString(), redeemed_at: null }),
  venue_mentions: () => ({ id: ++seq, created_at: new Date().toISOString() }),
  sms_messages: () => ({ id: ++seq, created_at: new Date(Date.now() + seq).toISOString() }),   // strictly increasing, like real rows
  sms_users: () => ({ opted_out: false, town_slug: null, first_name: null, notes: null, newsletter_opt_in_at: null }),
};
const UNIQUE = { deal_offers: [['code'], ['deal_id', 'phone']] };

function term(expr) {         // "col.is.null" | "col.gte.2026-01-01"
  const [col, op, ...rest] = expr.split('.');
  const val = rest.join('.');
  if (op === 'is' && val === 'null') return (r) => r[col] == null;
  if (op === 'gte') return (r) => r[col] != null && r[col] >= val;
  if (op === 'lte') return (r) => r[col] != null && r[col] <= val;
  if (op === 'eq') return (r) => String(r[col]) === val;
  return () => true;
}

function from(table) {
  touched.push(table);
  const rows = () => (T[table] ||= []);
  const s = { op: 'select', filters: [], opts: {}, payload: null, returning: false, one: null, limit: null, orders: [] };
  const hit = (r) => s.filters.every((f) => f(r));
  const add = (f) => { s.filters.push(f); return b; };
  const run = () => {
    if (failing) return { data: null, error: { message: 'boom' }, count: null };
    if (s.op === 'insert') {
      const made = [];
      for (const p of s.payload) {
        const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...p };
        for (const cols of UNIQUE[table] || []) {
          if (rows().some((r) => cols.every((c) => r[c] === row[c]))) return { data: null, error: { message: `duplicate key value violates unique constraint (${cols.join(',')})` } };
        }
        rows().push(row); made.push(row);
      }
      return { data: s.returning ? (s.one ? made[0] : made) : null, error: null };
    }
    if (s.op === 'update') { const m = rows().filter(hit); m.forEach((r) => Object.assign(r, s.payload)); return { data: s.returning ? m : null, error: null }; }
    if (s.op === 'delete') { T[table] = rows().filter((r) => !hit(r)); return { data: null, error: null }; }
    let out = rows().filter(hit);
    for (const [c, asc] of s.orders) out = [...out].sort((x, y) => (x[c] > y[c] ? 1 : x[c] < y[c] ? -1 : 0) * (asc ? 1 : -1));
    if (s.opts.head) return { data: null, error: null, count: out.length };
    if (s.limit != null) out = out.slice(0, s.limit);
    if (s.one) return { data: out[0] || null, error: null };
    return { data: out.map((r) => ({ ...r })), error: null, count: out.length };
  };
  const b = {
    select(_cols, opts) { if (s.op === 'select') s.opts = opts || {}; else s.returning = true; return b; },
    insert(p) { s.op = 'insert'; s.payload = Array.isArray(p) ? p : [p]; return b; },
    update(p) { s.op = 'update'; s.payload = p; return b; },
    delete() { s.op = 'delete'; return b; },
    eq: (c, v) => add((r) => r[c] === v),
    neq: (c, v) => add((r) => r[c] !== v),
    in: (c, vs) => add((r) => vs.includes(r[c])),
    lte: (c, v) => add((r) => r[c] != null && r[c] <= v),
    gte: (c, v) => add((r) => r[c] != null && r[c] >= v),
    is: (c, v) => add((r) => (v === null ? r[c] == null : r[c] === v)),
    not: (c, op, v) => add((r) => (op === 'is' && v === null ? r[c] != null : true)),
    ilike: (c, v) => add((r) => String(r[c]).toLowerCase().includes(v.replace(/%/g, '').toLowerCase())),
    or(expr) { const ts = expr.split(',').map(term); return add((r) => ts.some((t) => t(r))); },
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

// The fake agent: runs the real place search, then "writes" whatever reply the test set.
let nextReply = '';
let lastHistory = null;
fake('lib/agent.js', {
  runBuddy: async ({ history, channel }) => {
    lastHistory = history;
    const seen = new Map();
    await require('../lib/tools').searchPlaces({ town: 'Westwood' }, { channel, seen });
    return { reply: nextReply, toolCalls: [], seen: [...seen].map(([id, name]) => ({ id, name })) };
  },
});

const tools = require('../lib/tools');
const deals = require('../lib/deals');
const { handleInbound } = require('../lib/conversation');
const partner = require('./partner');
const { todayNJ, addDays } = require('../lib/dates');

const VENUE = (id, name, extra = {}) => ({ id, name, town_slug: 'westwood', category: 'food', tags: [], best_for: [], verified: true, status: 'open', plan: 'free', owner_verified_at: null, ...extra });
function reset() {
  for (const k of Object.keys(T)) delete T[k];
  touched.length = 0; failing = false;
  T.venues = [
    VENUE('v-fern', 'Little Fern Bakery', { plan: 'deals', owner_verified_at: '2026-11-01T00:00:00Z' }),
    VENUE('v-nine', 'Station Nine Kitchen'),
    VENUE('v-joes', "Joe's Pizza & Pasta", { plan: 'deals', owner_verified_at: '2026-11-01T00:00:00Z' }),
  ];
  T.deals = [{ ...DEFAULTS.deals(), id: 'd-fern', venue_id: 'v-fern', headline: '$25 off your first custom order' }];
}
const SEEN = [{ id: 'v-fern', name: 'Little Fern Bakery' }, { id: 'v-nine', name: 'Station Nine Kitchen' }, { id: 'v-joes', name: "Joe's Pizza & Pasta" }];
const CODE = /code (X163-[A-HJ-NP-Z2-9]{4})\./;
const ask = (reply, phone = '+15550100001', channel = 'sms', seen = SEEN) => deals.attachOffer({ reply, seen, phone, channel });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('search is identical whether or not anyone pays, and never reads deal data', async () => {
  reset();
  const withDeals = await tools.searchPlaces({ town: 'Westwood' }, { channel: 'test' });
  assert.ok(!touched.includes('deals') && !touched.includes('deal_offers'));
  T.deals = []; T.venues.forEach((v) => { v.plan = 'free'; v.owner_verified_at = null; });
  const without = await tools.searchPlaces({ town: 'Westwood' }, { channel: 'test' });
  assert.deepStrictEqual(withDeals, without);
  const json = JSON.stringify(withDeals);
  for (const leak of ['plan', 'owner_', 'deal', '"id"']) assert.ok(!json.includes(leak), `search output leaks ${leak}`);
});

test('a deal rides along on a place the reply already names, with a code and the one-time explainer', async () => {
  reset();
  const base = 'Station Nine Kitchen is the move for dinner. For cake after, Little Fern Bakery does nut-free.';
  const out = await ask(base);
  assert.ok(out.startsWith(base));
  assert.match(out, /\n\nDeal: \$25 off your first custom order at Little Fern Bakery\. Show this text, code X163-/);
  assert.match(out, CODE);
  assert.ok(out.endsWith('Places pay to add a deal. It never changes what I pick.'));
  assert.strictEqual(T.deal_offers.length, 1);
  assert.deepStrictEqual(T.venue_mentions.map((m) => m.venue_id).sort(), ['v-fern', 'v-nine']);
  assert.ok(!('phone' in T.venue_mentions[0]));
});

test('no deal when the reply does not name the paying place, even if search returned it', async () => {
  reset();
  const out = await ask('Station Nine Kitchen is your spot tonight.');
  assert.strictEqual(out, 'Station Nine Kitchen is your spot tonight.');
  assert.strictEqual((T.deal_offers || []).length, 0);
  assert.deepStrictEqual(T.venue_mentions.map((m) => m.venue_id), ['v-nine']);
});

test('same person: not repeated inside a day, same code and no explainer after that', async () => {
  reset();
  const first = await ask('Try Little Fern Bakery.');
  const code = first.match(CODE)[1];
  assert.strictEqual(await ask('Little Fern Bakery opens at 7.'), 'Little Fern Bakery opens at 7.');
  T.deal_offers[0].last_shown_at = new Date(Date.now() - 25 * 3600e3).toISOString();
  const later = await ask('Little Fern Bakery again?');
  assert.strictEqual(later.match(CODE)[1], code);
  assert.ok(!later.includes('Places pay'));
  assert.strictEqual(T.deal_offers.length, 1);
});

test('a different person gets a different code', async () => {
  reset();
  const a = (await ask('Little Fern Bakery.', '+15550100001')).match(CODE)[1];
  const b = (await ask('Little Fern Bakery.', '+15550100002')).match(CODE)[1];
  assert.notStrictEqual(a, b);
});

test('the cap stops new codes', async () => {
  reset(); T.deals[0].redemption_cap = 1;
  assert.match(await ask('Little Fern Bakery.', '+15550100001'), CODE);
  assert.strictEqual(await ask('Little Fern Bakery.', '+15550100002'), 'Little Fern Bakery.');
});

test('no deal when it is paused, out of date, the place is on the free plan, or the owner is not verified', async () => {
  const cases = [
    () => { T.deals[0].status = 'paused'; },
    () => { T.deals[0].ends_on = addDays(todayNJ(), -1); },
    () => { T.deals[0].starts_on = addDays(todayNJ(), 1); },
    () => { T.venues[0].plan = 'free'; },
    () => { T.venues[0].owner_verified_at = null; },
  ];
  for (const change of cases) { reset(); change(); assert.strictEqual(await ask('Little Fern Bakery.'), 'Little Fern Bakery.'); assert.strictEqual((T.deal_offers || []).length, 0); }
});

test('one deal per answer, for the place named first', async () => {
  reset();
  T.deals.push({ ...DEFAULTS.deals(), id: 'd-joes', venue_id: 'v-joes', headline: 'Free garlic knots', first_time_only: true, terms: 'Dine-in only.' });
  const out = await ask("Joes Pizza and Pasta for dinner, then Little Fern Bakery.");
  assert.strictEqual(out.split('Deal: ').length, 2);
  assert.match(out, /Deal: Free garlic knots \(first visit only\) at Joe's Pizza & Pasta\. Dine-in only\. Show this text, code X163-/);
});

test('a "Deal:" line the model wrote itself is removed', async () => {
  reset();
  const out = await ask('Station Nine Kitchen is great.\nDeal: 50% off everything!\nGo early.');
  assert.strictEqual(out, 'Station Nine Kitchen is great.\nGo early.');
});

test('the test channel shows the line but writes nothing', async () => {
  reset();
  const out = await ask('Little Fern Bakery.', '+15550100001', 'test');
  assert.ok(out.includes(`code ${deals.TEST_CODE}.`));
  assert.strictEqual((T.deal_offers || []).length + (T.venue_mentions || []).length, 0);
});

test('a database failure never costs the answer', async () => {
  reset(); failing = true;
  assert.strictEqual(await ask('Little Fern Bakery.'), 'Little Fern Bakery.');
});

test('stripOffer removes the deal block and nothing else', () => {
  assert.strictEqual(deals.stripOffer('Go to X.\n\nDeal: Free thing at X. Show this text, code X163-AAAA.'), 'Go to X.');
  assert.strictEqual(deals.stripOffer('No deal here.'), 'No deal here.');
});

test('end to end: the text carries the deal, the agent\'s history does not', async () => {
  reset();
  nextReply = 'Little Fern Bakery is the one.';
  const first = await handleInbound({ phone: '+15550100009', text: 'birthday cake by saturday?', channel: 'sms' });
  assert.match(first.reply, CODE);
  assert.match(T.sms_messages.filter((m) => m.direction === 'out')[0].body, CODE);   // the log shows what was sent
  nextReply = 'Station Nine Kitchen.';
  await handleInbound({ phone: '+15550100009', text: 'and dinner?', channel: 'sms' });
  const said = lastHistory.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n');
  assert.strictEqual(said, 'Little Fern Bakery is the one.');
});

test('forgetPhone deletes that person\'s codes only', async () => {
  reset();
  await ask('Little Fern Bakery.', '+15550100001'); await ask('Little Fern Bakery.', '+15550100002');
  await deals.forgetPhone('+15550100001');
  assert.deepStrictEqual(T.deal_offers.map((o) => o.phone), ['+15550100002']);
});

test('partner script: verify, plan, deal, redeem, stats; restricted copy is refused', async () => {
  reset(); T.deals = [];
  const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(' '));
  try {
    await partner.main(['verify', 'v-nine', '--email', 'Owner@Nine.com', '--phone', '(201) 555-0163']);
    await partner.main(['plan', 'v-nine', 'deals']);
    await partner.main(['deal', 'v-nine', 'Free dessert with dinner', '--cap', '20', '--ends', addDays(todayNJ(), 30)]);
    await assert.rejects(partner.main(['deal', 'v-nine', '2-for-1 cocktails']), /carriers restrict/);
    const out = await ask('Station Nine Kitchen.');
    await partner.main(['redeem', out.match(CODE)[1]]);
    await partner.main(['stats', 'v-nine']);
  } finally { console.log = log; }
  const v = T.venues.find((x) => x.id === 'v-nine');
  assert.strictEqual(v.claimed_by_email, 'owner@nine.com'); assert.strictEqual(v.owner_phone, '+12015550163'); assert.strictEqual(v.plan, 'deals');
  assert.strictEqual(T.deals.filter((d) => d.status === 'active').length, 1);
  assert.ok(T.deal_offers[0].redeemed_at);
  const text = lines.join('\n');
  assert.match(text, /recommended:\s+1 times/); assert.match(text, /deal codes out: 1/); assert.match(text, /redeemed:\s+1/);
});

(async () => {
  let failed = 0;
  const realError = console.error; console.error = () => {};   // attachOffer logs the failures we cause on purpose
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
  }
  console.error = realError;
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
