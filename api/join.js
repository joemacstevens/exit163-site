// /api/join — the landing page's one signup form: phone, email, or both.
//
// POST { phone?, email?, website? (honeypot) }
//   email -> Resend newsletter list + welcome email (same as /api/subscribe)
//   phone -> sms_users row + one confirmation text asking the person to reply JOIN.
//            Nothing recurring is sent until they reply JOIN (double opt-in), which
//            api/sms.js already handles.
// GET -> { number } : the public text-line number, so the page can show "text JOIN to ...".
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_*,
//      TEXT_LINE_NUMBER (optional; display number, defaults to TWILIO_FROM_NUMBER).
const { readBody } = require('../lib/http');
const { EMAIL_RE, addSubscriber, sendWelcome } = require('../lib/newsletter');
const { db, q } = require('../lib/db');
const { sendSms } = require('../lib/twilio');

const CONFIRM_TEXT = "Exit 163 here, your Bergen County local agent. Reply JOIN to confirm and get the Friday weekend text (about 1 msg/wk), plus answers whenever you text me. Msg & data rates may apply. Reply HELP for help, STOP to cancel.";
const RESEND_WINDOW_MS = 24 * 3600e3; // at most one confirmation text per number per day

// US/Canada numbers only (NANP): 10 digits, area code and exchange can't start with 0/1.
function toE164(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return '+1' + d;
}

function displayNumber() {
  const n = toE164(process.env.TEXT_LINE_NUMBER || process.env.TWILIO_FROM_NUMBER || '');
  if (!n) return null;
  return { e164: n, pretty: `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` };
}

async function joinPhone(phone, email) {
  const existing = await q(db().from('sms_users').select('*').eq('phone', phone).maybeSingle());
  if (existing?.opted_out) return { status: 'opted_out' };
  if (existing?.blast_opt_in) return { status: 'already' };

  const row = { prefs: { ...(existing?.prefs || {}), source: 'web' } };
  if (email) Object.assign(row, { email, newsletter_opt_in_at: new Date().toISOString() });
  if (existing) await q(db().from('sms_users').update(row).eq('phone', phone));
  else await q(db().from('sms_users').insert({ phone, ...row }));

  const since = new Date(Date.now() - RESEND_WINDOW_MS).toISOString();
  const recent = await q(db().from('sms_messages').select('id').eq('phone', phone)
    .eq('direction', 'out').eq('body', CONFIRM_TEXT).gte('created_at', since).limit(1));
  if (recent.length) return { status: 'sent' }; // already pending; don't re-text

  await sendSms(phone, CONFIRM_TEXT);
  await q(db().from('sms_messages').insert({ phone, direction: 'out', body: CONFIRM_TEXT })).catch(() => {});
  return { status: 'sent' };
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ number: displayNumber() });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }

  const body = await readBody(req);
  if (body.website) return res.status(200).json({ ok: true, email: body.email ? 'ok' : null, phone: body.phone ? 'sent' : null });

  const rawEmail = String(body.email || '').trim().toLowerCase();
  const rawPhone = String(body.phone || '').trim();
  if (!rawEmail && !rawPhone) return res.status(400).json({ ok: false, error: 'Add your phone number, your email, or both.' });

  const email = rawEmail && EMAIL_RE.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;
  if (rawEmail && !email) return res.status(400).json({ ok: false, field: 'email', error: 'That email doesn’t look right.' });
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !phone) return res.status(400).json({ ok: false, field: 'phone', error: 'Use a 10-digit US mobile number.' });

  const out = { ok: true, email: null, phone: null };
  const jobs = [];
  if (email) {
    jobs.push(addSubscriber(email)
      .then(async ({ isNew }) => {
        out.email = 'ok';
        if (isNew) await sendWelcome(email).catch((e) => console.error('welcome email failed', e));
      })
      .catch((e) => { console.error('join email failed', e); out.email = 'error'; }));
  }
  if (phone) {
    jobs.push(joinPhone(phone, email)
      .then((r) => { out.phone = r.status; })
      .catch((e) => { console.error('join phone failed', e); out.phone = 'error'; }));
  }
  await Promise.all(jobs);

  const failed = [out.email, out.phone].filter((s) => s === 'error').length;
  const attempted = [email, phone].filter(Boolean).length;
  if (failed === attempted) return res.status(502).json({ ...out, ok: false, error: 'Something went wrong. Please try again.' });
  return res.status(200).json(out);
};

module.exports.toE164 = toE164;
