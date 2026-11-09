// POST /api/blast — send the weekly text to everyone who replied JOIN.
// Auth: header "Authorization: Bearer <ADMIN_TOKEN>".
// Body: { "body": "message text", "dry_run": true }  (dry_run defaults to true; send with false)
// Only sends 8am-9pm NJ time. Opted-out numbers are skipped (and Twilio blocks them too).
const { readBody } = require('../lib/http');
const { db, q } = require('../lib/db');
const { sendSms } = require('../lib/twilio');
const { hourNJ } = require('../lib/dates');

const FOOTER = '\nReply STOP to opt out.';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const b = await readBody(req);
  const text = String(b.body || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'body required' });
  const message = text.includes('STOP') ? text : text + FOOTER;
  const dryRun = b.dry_run !== false;

  const recipients = await q(db().from('sms_users').select('phone').eq('blast_opt_in', true).eq('opted_out', false));
  if (dryRun) return res.status(200).json({ ok: true, dry_run: true, recipients: recipients.length, message, chars: message.length });

  const hour = hourNJ();
  if (hour < 8 || hour >= 21) return res.status(409).json({ ok: false, error: `Quiet hours: it's ${hour}:00 in NJ. Texts go out 8am-9pm only.` });

  let sent = 0;
  const failed = [];
  for (const { phone } of recipients) {
    try {
      await sendSms(phone, message);
      await q(db().from('sms_messages').insert({ phone, direction: 'out', body: message }));
      sent++;
    } catch (e) {
      failed.push({ phone: phone.slice(0, -4) + '****', error: e.message });
    }
  }
  return res.status(200).json({ ok: true, sent, failed });
};
