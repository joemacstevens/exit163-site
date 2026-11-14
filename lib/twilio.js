// Minimal Twilio helpers: webhook signature check, TwiML reply, outbound send.
const crypto = require('crypto');

// https://www.twilio.com/docs/usage/webhooks/webhooks-security
function validSignature(req, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const sig = req.headers['x-twilio-signature'];
  if (!sig) return false;
  const url = publicBase(req) + req.url;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Where Twilio reports what became of a text (lib/delivery.js). The path is relative on a reply,
// so it lands on the same host the inbound webhook came in on.
const STATUS_PATH = '/api/sms-status';

// Twilio wants the callback on both attributes: which one it reads depends on the account's age.
// https://www.twilio.com/docs/messaging/twiml/message
function twiml(res, message) {
  res.setHeader('Content-Type', 'text/xml');
  const body = message ? `<Message action="${STATUS_PATH}" statusCallback="${STATUS_PATH}" method="POST">${esc(message)}</Message>` : '';
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
}

const publicBase = (req) =>
  (process.env.PUBLIC_BASE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

async function sendSms(to, body, { statusCallback } = {}) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const form = new URLSearchParams({ To: to, Body: body });
  if (statusCallback) form.set('StatusCallback', statusCallback);
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

async function get(path) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${out.message || 'read failed'}`);
  return out;
}

// One text as Twilio has it: { sid, to, body, direction, status, error_code, date_created, ... }.
const getMessage = (messageSid) => get(`Messages/${encodeURIComponent(messageSid)}.json`);

// The latest texts to one number, newest first.
const recentTo = async (to, limit = 20) =>
  (await get(`Messages.json?To=${encodeURIComponent(to)}&PageSize=${limit}`)).messages || [];

module.exports = { validSignature, twiml, sendSms, getMessage, recentTo, publicBase, STATUS_PATH };
