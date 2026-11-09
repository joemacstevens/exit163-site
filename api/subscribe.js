// POST /api/subscribe — adds an email to the Exit 163 list in Resend.
// Env: RESEND_API_KEY (required, full-access key). Segment/topic IDs can be overridden by env.
const { addSubscriber, sendWelcome } = require('../lib/newsletter');
const { readBody } = require('../lib/http');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
  const wantsJson = (req.headers.accept || '').includes('application/json');
  const reply = (status, payload, redirect) =>
    wantsJson ? res.status(status).json(payload) : res.redirect(303, redirect);

  const body = await readBody(req);
  if (body.website) return reply(200, { ok: true }, '/?subscribed=1'); // honeypot: bots fill hidden field
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return reply(400, { ok: false, error: 'Please enter a valid email.' }, '/?subscribe_error=1');
  if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY missing'); return reply(500, { ok: false, error: 'Signup is temporarily down. Try again soon.' }, '/?subscribe_error=1'); }

  try {
    const { isNew } = await addSubscriber(email);
    if (isNew) await sendWelcome(email).catch((e) => console.error('welcome email failed', e));
    return reply(200, { ok: true }, '/?subscribed=1');
  } catch (e) {
    console.error(e);
    return reply(502, { ok: false, error: 'Something went wrong. Please try again.' }, '/?subscribe_error=1');
  }
};
