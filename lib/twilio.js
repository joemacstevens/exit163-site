// Minimal Twilio helpers: webhook signature check, TwiML reply, outbound send.
const crypto = require('crypto');

// https://www.twilio.com/docs/usage/webhooks/webhooks-security
function validSignature(req, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const sig = req.headers['x-twilio-signature'];
  if (!sig) return false;
  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const url = base.replace(/\/$/, '') + req.url;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function twiml(res, message) {
  res.setHeader('Content-Type', 'text/xml');
  const body = message ? `<Message>${esc(message)}</Message>` : '';
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', process.env.TWILIO_FROM_NUMBER);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
    body: form,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${out.message || 'send failed'}`);
  return out.sid;
}

module.exports = { validSignature, twiml, sendSms };
