// Offline test: a tapback ("Liked “…”") is logged but never answered. No network, no database,
// no model: lib/db.js and lib/agent.js are in-memory fakes.
//   node scripts/test-reactions.js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- fakes ----------
const T = { sms_users: [], sms_messages: [] };
function from(table) {
  const s = { op: 'select', filters: [], payload: null, one: false };
  const hit = (r) => s.filters.every((f) => f(r));
  const run = () => {
    if (s.op === 'insert') { T[table].push(...s.payload.map((p) => ({ ...p }))); return { data: s.one ? { ...s.payload[0] } : null, error: null }; }
    if (s.op === 'update') { T[table].filter(hit).forEach((r) => Object.assign(r, s.payload)); return { data: null, error: null }; }
    const out = T[table].filter(hit);
    return { data: s.one ? (out[0] ? { ...out[0] } : null) : out.map((r) => ({ ...r })), error: null };
  };
  const b = {
    select() { return b; },
    insert(p) { s.op = 'insert'; s.payload = Array.isArray(p) ? p : [p]; return b; },
    update(p) { s.op = 'update'; s.payload = p; return b; },
    eq(c, v) { s.filters.push((r) => r[c] === v); return b; },
    gte() { return b; }, order() { return b; }, limit() { return b; },
    maybeSingle() { s.one = true; return b; },
    single() { s.one = true; return b; },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}
const fake = (rel, exports) => { const f = require.resolve(path.join(ROOT, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
fake('lib/db.js', { db: () => ({ from }), q: async (p) => { const { data, error } = await p; if (error) throw new Error(`db: ${error.message}`); return data; } });
let asked = 0;
fake('lib/agent.js', { runBuddy: async () => { asked++; return { reply: 'Here you go.', toolCalls: [] }; } });
fake('lib/followups.js', { forContext: async () => [], describe: () => '', cancelOpen: async () => {} });
fake('lib/memory.js', { loadFacts: async () => [], describeFacts: () => '' });

const { handleInbound, isReaction } = require(path.join(ROOT, 'lib/conversation.js'));

const PHONE = '+15550100001';
const SENT = "Okay, here's your weekend 👍🏼\n\nDate night: \"Dracula: A Comedy of Terrors\" at Bergen County Players in Oradell. It closes Saturday.\n\nWant me to find a dinner spot or a movie? btw, what should I call you?";
const reset = () => { T.sms_users = [{ phone: PHONE, opted_out: false, town_slug: 'oradell', prefs: {} }]; T.sms_messages = []; asked = 0; };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- what counts as a reaction ----------
test('iPhone tapbacks, as they arrive over SMS', () => {
  for (const verb of ['Liked', 'Loved', 'Disliked', 'Laughed at', 'Emphasized', 'Questioned']) {
    assert.ok(isReaction(`${verb} “${SENT}”`), verb);
  }
  assert.ok(isReaction("Liked “Give me one sec, I'm digging. If I don't text back, try me again or peek at exit163.com.”"));
  assert.ok(isReaction('Liked “Talk soon 👋”  '));
  assert.ok(isReaction('Emphasised “Go early.”'));
  assert.ok(isReaction('Liked "Go early."'), 'straight quotes');
});
test('emoji reactions: iPhone "Reacted", Android "👍 to"', () => {
  assert.ok(isReaction('Reacted 😂 to “Have fun this weekend!”'));
  assert.ok(isReaction('Reacted 👍🏼 to “Have fun this weekend!”'));
  assert.ok(isReaction('👍 to “Have fun this weekend!”'));
  assert.ok(isReaction('​❤️​ to “ Have fun this weekend! ”'));
  assert.ok(isReaction('😂 to "Have fun this weekend!"'));
});
test('taking a reaction back, and reactions to a picture', () => {
  assert.ok(isReaction('Removed a like from “Have fun this weekend!”'));
  assert.ok(isReaction('Removed a heart from “Have fun this weekend!”'));
  assert.ok(isReaction('Removed an exclamation from “Have fun this weekend!”'));
  assert.ok(isReaction('Removed 👍 from “Have fun this weekend!”'));
  assert.ok(isReaction('Liked an image'));
  assert.ok(isReaction('Removed a like from an image'));
  assert.ok(isReaction('Loved a photo.'));
});
test('a reaction cut to length has no closing quote and still counts', () => {
  const cut = `Liked “${'x'.repeat(1200)}”`.slice(0, 1000);
  assert.ok(!isReaction(cut), 'unknown whether it was cut: not assumed');
  assert.ok(isReaction(cut, true));
});
test('real questions that look a little like one still reach the agent', () => {
  for (const text of [
    'Loved "A Christmas Story" last night, what else is like it?',
    'Liked “Dracula” a lot. Anything similar next weekend?',
    'Going to "Dracula" tonight, where should we eat?',
    'Liked it! What about Sunday?',
    'Loved the craft fair',
    'Liked',
    'Date night',
    "What's going on today",
    'Food',
    'Thanks 👍',
    '👍',
    'Is "A Christmas Story" a play?',
    'Take me to "the good stuff"',
    'Questioned whether to go. Is it worth $29?',
    'Liked a lot of those, any with live music?',
  ]) assert.ok(!isReaction(text), text);
});

// ---------- what the agent does with one ----------
test('a reaction is logged and gets no reply, and the model is never asked', async () => {
  const out = await handleInbound({ phone: PHONE, text: `Liked “${SENT}”`, channel: 'test' });
  assert.strictEqual(out.reply, null);
  assert.strictEqual(asked, 0);
  assert.deepStrictEqual(T.sms_messages.map((m) => m.direction), ['in']);
  assert.ok(T.sms_messages[0].body.startsWith('Liked “Okay'));
});
test('three reactions in a row stay quiet (the sign-off pile-up of 2026-11-13)', async () => {
  for (const text of ['Liked “Anytime! Have the best date night 🙏🏼”', 'Liked “Enjoy your weekend!”', 'Liked “Have fun this weekend! Text me anytime.”']) {
    assert.strictEqual((await handleInbound({ phone: PHONE, text, channel: 'test' })).reply, null);
  }
  assert.strictEqual(asked, 0);
  assert.strictEqual(T.sms_messages.filter((m) => m.direction === 'out').length, 0);
});
test('a long reaction that Twilio delivers past our length cut stays quiet', async () => {
  const out = await handleInbound({ phone: PHONE, text: `Loved “${'Great pick. '.repeat(120)}”`, channel: 'test' });
  assert.strictEqual(out.reply, null);
  assert.strictEqual(asked, 0);
});
test('an ordinary text after a reaction is answered as usual', async () => {
  await handleInbound({ phone: PHONE, text: 'Liked “Enjoy your weekend!”', channel: 'test' });
  const out = await handleInbound({ phone: PHONE, text: 'Loved "A Christmas Story" last night, what else is like it?', channel: 'test' });
  assert.strictEqual(out.reply, 'Here you go.');
  assert.strictEqual(asked, 1);
});
test('JOIN and STOP are untouched', async () => {
  assert.match((await handleInbound({ phone: PHONE, text: 'Join', channel: 'test' })).reply, /^You're in!/);
  assert.strictEqual((await handleInbound({ phone: PHONE, text: 'STOP', channel: 'test' })).reply, null);
  assert.strictEqual(T.sms_users[0].opted_out, true);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    reset();
    try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n').join('\n      ')); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
