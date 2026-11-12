// POST /api/blast — send the weekly text to everyone who replied JOIN.
// Auth: header "Authorization: Bearer <ADMIN_TOKEN>".
// Body: {
//   "body": "message text",            // the same for everyone
//   "issue_date": "2026-11-20",        // optional: put each person's saved personal line (personal_picks) on top
//   "fallback_line": "Not your thing? Text back what is - kids, date night, food.",  // optional: added at the end for people with no personal line
//   "dry_run": true                    // defaults to true; send with false
// }
// Only sends 8am-9pm NJ time. Opted-out numbers are skipped (and Twilio blocks them too).
const { readBody } = require('../lib/http');
const { db, q } = require('../lib/db');
const { sendSms } = require('../lib/twilio');
const { hourNJ } = require('../lib/dates');

const FOOTER = '\nReply STOP to opt out.';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const mask = (p) => p.slice(0, -4).replace(/\d/g, '•') + p.slice(-4);

function compose(text, personal, fallback) {
  const parts = personal ? [personal, text] : [text, fallback].filter(Boolean);
  const msg = parts.join('\n');
  return msg.includes('STOP') ? msg : msg + FOOTER;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const b = await readBody(req);
  const text = String(b.body || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'body required' });
  const fallback = String(b.fallback_line || '').trim();
  const issueDate = b.issue_date ? String(b.issue_date) : null;
  if (issueDate && !YMD.test(issueDate)) return res.status(400).json({ ok: false, error: 'issue_date must be YYYY-MM-DD' });
  const dryRun = b.dry_run !== false;

  const recipients = await q(db().from('sms_users').select('phone').eq('blast_opt_in', true).eq('opted_out', false));
  const picks = new Map();
  if (issueDate) {
    for (const r of await q(db().from('personal_picks').select('phone,line').eq('issue_date', issueDate))) picks.set(r.phone, r.line);
  }
  const messages = recipients.map(({ phone }) => ({ phone, message: compose(text, picks.get(phone), fallback) }));
  const personalized = messages.filter((m) => picks.has(m.phone));

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dry_run: true,
      recipients: recipients.length,
      personalized: personalized.length,
      message: compose(text, null, fallback),
      chars: compose(text, null, fallback).length,
      max_chars: Math.max(0, ...messages.map((m) => m.message.length)),
      personal_samples: personalized.slice(0, 5).map((m) => ({ to: mask(m.phone), chars: m.message.length, message: m.message })),
    });
  }

  const hour = hourNJ();
  if (hour < 8 || hour >= 21) return res.status(409).json({ ok: false, error: `Quiet hours: it's ${hour}:00 in NJ. Texts go out 8am-9pm only.` });

  let sent = 0;
  const failed = [];
  for (const { phone, message } of messages) {
    try {
      await sendSms(phone, message);
      await q(db().from('sms_messages').insert({ phone, direction: 'out', body: message }));
      sent++;
    } catch (e) {
      failed.push({ phone: mask(phone), error: e.message });
    }
  }
  return res.status(200).json({ ok: true, sent, personalized: personalized.length, failed });
};
