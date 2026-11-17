// Offline test for delivery tracking (a blocked reply is re-sent once in shorter pieces).
// No network, no texts, no email: Twilio reads/sends and the owner email are in-memory fakes.
//   node scripts/test-delivery.js
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.PUBLIC_BASE_URL = 'https://www.exit163.com';
delete process.env.SKIP_TWILIO_SIGNATURE;

// ---------- fakes ----------
const real = require(path.join(ROOT, 'lib/twilio.js'));
const twilio = { messages: {}, log: [], sent: [], failSendAt: null };
const emails = [];
const fake = (rel, exports) => { const f = require.resolve(path.join(ROOT, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
fake('lib/twilio.js', {
  ...real,
  getMessage: async (sid) => { if (!twilio.messages[sid]) throw new Error('Twilio 404: not found'); return twilio.messages[sid]; },
  recentTo: async (to) => twilio.log.filter((m) => m.to === to),
  sendSms: async (to, body, opts = {}) => {
    if (twilio.failSendAt === twilio.sent.length) throw new Error('Twilio 400: nope');
    twilio.sent.push({ to, body, ...opts });
    return 'SMnew' + twilio.sent.length;
  },
});
fake('lib/notify.js', { ...require(path.join(ROOT, 'lib/notify.js')), emailOwner: async (subject, html) => { emails.push({ subject, html }); return true; } });
const { handleStatus, splitForResend } = require(path.join(ROOT, 'lib/delivery.js'));
const statusApi = require(path.join(ROOT, 'api/sms-status.js'));

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const reset = () => { twilio.messages = {}; twilio.log = []; twilio.sent = []; twilio.failSendAt = null; emails.length = 0; };

// The shape of the reply a carrier blocked on 2026-11-13 (made-up names).
const BLOCKED = "Tonight's a good one. Maria Lopez is at the Blue Room, the jazz club on Main St in Teaneck, about 10 minutes from you. She's a pianist and singer who mixes Cuban rhythms with jazz and soul. Sets are at 8 and 9:30pm, $17 to $59, and each set needs its own ticket.\n\nBackups:\n- The Ramps, a rock and pop cover band, play the Tavern in New Milford at 9:30pm. It's about 5 minutes away, and they haven't posted a price.\n- Comedian Sam Doe does one night only at the Cellar in Bergenfield. Time and price aren't posted.";
const PHONE = '+12015550123';
const NOW = Date.parse('2026-11-13T21:46:30Z');
const blockedMsg = (over = {}) => ({ sid: 'SMblocked', to: PHONE, body: BLOCKED, direction: 'outbound-reply', date_created: 'Fri, 13 Nov 2026 21:46:10 +0000', ...over });
const report = (over = {}) => ({ MessageSid: 'SMblocked', MessageStatus: 'undelivered', ErrorCode: '30007', To: PHONE, ...over });
const BASE = 'https://www.exit163.com';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- the reply asks for a delivery report ----------
test('a reply names the status callback on both attributes', () => {
  let sent; const res = { setHeader() {}, status() { return this; }, send(x) { sent = x; } };
  real.twiml(res, 'Hi & <bye>');
  assert.match(sent, /<Message action="\/api\/sms-status" statusCallback="\/api\/sms-status" method="POST">Hi &amp; &lt;bye&gt;<\/Message>/);
});
test('no reply, no <Message>', () => {
  let sent; const res = { setHeader() {}, status() { return this; }, send(x) { sent = x; } };
  real.twiml(res, null);
  assert.ok(!sent.includes('<Message'));
});

// ---------- splitting ----------
test('the blocked reply splits into two short plain texts', () => {
  const parts = splitForResend(BLOCKED);
  assert.strictEqual(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 300), parts.map((p) => p.length).join(','));
  assert.ok(parts[0].startsWith("Tonight's a good one."));
  assert.ok(parts[1].startsWith('Backups: The Ramps'));
  assert.ok(!parts.join('\n').includes('\n- '), 'bullets are gone');
});
test('nothing is lost in the split', () => {
  const words = (s) => s.replace(/^\s*-\s+/gm, '').split(/\s+/).filter(Boolean).join(' ');
  assert.strictEqual(words(splitForResend(BLOCKED).join(' ')), words(BLOCKED));
});
test('a long paragraph breaks at sentence ends', () => {
  const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} is here to take up some room.`).join(' ');
  const parts = splitForResend(long);
  assert.ok(parts.length >= 2 && parts.length <= 4);
  assert.ok(parts.every((p) => /\.$/.test(p)));
  assert.strictEqual(parts.join(' '), long);
});
test('never more than four texts', () => {
  const many = Array.from({ length: 9 }, (_, i) => `Line ${i + 1}: ` + 'x'.repeat(250)).join('\n');
  assert.strictEqual(splitForResend(many).length, 4);
});
test('a short reply stays one text', () => {
  assert.deepStrictEqual(splitForResend('Got it, Closter. What are you into?'), ['Got it, Closter. What are you into?']);
});

// ---------- the delivery report ----------
test('delivered, sent and queued reports do nothing', async () => {
  for (const MessageStatus of ['queued', 'sent', 'delivered']) {
    assert.deepStrictEqual(await handleStatus({ params: report({ MessageStatus, ErrorCode: '' }), base: BASE, now: NOW }), { action: 'ignored' });
  }
  assert.strictEqual(twilio.sent.length + emails.length, 0);
});
test('a carrier block re-sends the answer in pieces that report back as the re-send', async () => {
  twilio.messages.SMblocked = blockedMsg(); twilio.log = [blockedMsg()];
  const out = await quiet(() => handleStatus({ params: report(), base: BASE, now: NOW }));
  assert.deepStrictEqual(out, { action: 'resent', parts: 2 });
  assert.deepStrictEqual(twilio.sent.map((s) => s.body), splitForResend(BLOCKED));
  assert.ok(twilio.sent.every((s) => s.to === PHONE && s.statusCallback === 'https://www.exit163.com/api/sms-status?retry=1'));
  assert.strictEqual(emails.length, 0);
});
test('"failed" with 30008 is re-sent too', async () => {
  twilio.messages.SMblocked = blockedMsg();
  const out = await quiet(() => handleStatus({ params: report({ MessageStatus: 'failed', ErrorCode: '30008' }), base: BASE, now: NOW }));
  assert.strictEqual(out.action, 'resent');
});
test('a block on the re-send emails the owner and sends nothing more', async () => {
  twilio.messages.SMnew1 = blockedMsg({ sid: 'SMnew1', body: 'piece one', direction: 'outbound-api' });
  const out = await quiet(() => handleStatus({ params: report({ MessageSid: 'SMnew1' }), retry: true, base: BASE, now: NOW }));
  assert.deepStrictEqual(out, { action: 'alerted' });
  assert.strictEqual(twilio.sent.length, 0);
  assert.strictEqual(emails.length, 1);
  assert.match(emails[0].subject, /blocked twice/);
  assert.ok(emails[0].html.includes('piece one') && emails[0].html.includes('…0123') && !emails[0].html.includes(PHONE), 'last four digits only');
});
test('a landline, an unreachable phone or a STOP is logged, not re-sent', async () => {
  twilio.messages.SMblocked = blockedMsg();
  for (const ErrorCode of ['30003', '30005', '30006', '21610', '']) {
    assert.deepStrictEqual(await quiet(() => handleStatus({ params: report({ ErrorCode }), base: BASE, now: NOW })), { action: 'logged' });
  }
  assert.strictEqual(twilio.sent.length + emails.length, 0);
});
test('the same report twice re-sends once', async () => {
  twilio.messages.SMblocked = blockedMsg();
  const first = splitForResend(BLOCKED)[0];
  twilio.log = [{ sid: 'SMnew1', to: PHONE, body: first, direction: 'outbound-api', date_created: 'Fri, 13 Nov 2026 21:46:20 +0000' }, blockedMsg()];
  const out = await quiet(() => handleStatus({ params: report(), base: BASE, now: NOW }));
  assert.deepStrictEqual(out, { action: 'duplicate' });
  assert.strictEqual(twilio.sent.length, 0);
});
test('the same words sent before the block do not count as the re-send', async () => {
  twilio.messages.SMblocked = blockedMsg();
  twilio.log = [blockedMsg(), { sid: 'SMold', to: PHONE, body: splitForResend(BLOCKED)[0], direction: 'outbound-reply', date_created: 'Fri, 13 Nov 2026 20:00:00 +0000' }];
  const out = await quiet(() => handleStatus({ params: report(), base: BASE, now: NOW }));
  assert.strictEqual(out.action, 'resent');
});
test('a report that arrives after half an hour emails the owner instead', async () => {
  twilio.messages.SMblocked = blockedMsg();
  const out = await quiet(() => handleStatus({ params: report(), base: BASE, now: NOW + 45 * 60 * 1000 }));
  assert.deepStrictEqual(out, { action: 'alerted' });
  assert.strictEqual(twilio.sent.length, 0);
  assert.match(emails[0].subject, /too late/);
});
test('Twilio refusing the re-send emails the owner', async () => {
  twilio.messages.SMblocked = blockedMsg(); twilio.failSendAt = 1;
  const out = await quiet(() => handleStatus({ params: report(), base: BASE, now: NOW }));
  assert.deepStrictEqual(out, { action: 'alerted', parts: 1 });
  assert.match(emails[0].subject, /re-send failed/);
});

// ---------- the endpoint ----------
const sign = (url, params) => crypto.createHmac('sha1', 'test-token').update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest('base64');
const call = async ({ method = 'POST', url = '/api/sms-status', params = report(), signature }) => {
  const res = { code: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send() { return this; }, end() { return this; } };
  const headers = { host: 'www.exit163.com', 'content-type': 'application/x-www-form-urlencoded' };
  if (signature !== null) headers['x-twilio-signature'] = signature || sign('https://www.exit163.com' + url, params);
  await quiet(() => statusApi({ method, url, headers, body: params }, res));
  return res;
};
test('endpoint: GET is refused', async () => { assert.strictEqual((await call({ method: 'GET' })).code, 405); });
test('endpoint: a bad or missing signature is refused and sends nothing', async () => {
  twilio.messages.SMblocked = blockedMsg({ date_created: new Date().toUTCString() });
  assert.strictEqual((await call({ signature: 'nope' })).code, 403);
  assert.strictEqual((await call({ signature: null })).code, 403);
  assert.strictEqual(twilio.sent.length, 0);
});
test('endpoint: a signed block report re-sends', async () => {
  twilio.messages.SMblocked = blockedMsg({ date_created: new Date().toUTCString() });
  assert.strictEqual((await call({})).code, 204);
  assert.strictEqual(twilio.sent.length, 2);
});
test('endpoint: ?retry=1 is signed as part of the URL and never re-sends', async () => {
  twilio.messages.SMblocked = blockedMsg({ date_created: new Date().toUTCString() });
  assert.strictEqual((await call({ url: '/api/sms-status?retry=1' })).code, 204);
  assert.strictEqual(twilio.sent.length, 0);
  assert.strictEqual(emails.length, 1);
});
test('endpoint: a crash still answers 204 so Twilio does not repeat the report', async () => {
  assert.strictEqual((await call({ params: report({ MessageSid: 'SMmissing' }) })).code, 204);
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
