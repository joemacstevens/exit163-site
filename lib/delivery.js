// What to do when Twilio says a reply never reached the phone.
//
// Every reply from /api/sms carries a status callback (lib/twilio.js twiml). When a carrier's spam
// filter rejects one (error 30007), the person just gets silence. So: split the same answer into
// shorter plain texts and send it once more. If that is blocked too, email the owner and stop.
// Nothing is stored: the blocked text is read back from Twilio by its SID.
const { sendSms, getMessage, recentTo, STATUS_PATH } = require('./twilio');
const { emailOwner, esc } = require('./notify');

const FAILED = new Set(['undelivered', 'failed']);
// Worth a second try in a different shape: 30007 carrier filtered the content, 30008 carrier gave no reason.
// Not worth it: 30003 phone unreachable, 30005 unknown number, 30006 landline, 21610 they texted STOP.
const RESEND_CODES = new Set(['30007', '30008']);
const MAX_AGE_MS = 30 * 60 * 1000;   // a delivery report can arrive hours late; an answer that old is stale
const PART_CHARS = 300;              // two SMS segments
const MAX_PARTS = 4;

/** Split a reply into short plain texts: no bullets, a "Backups:" header folded into the line after it. */
function splitForResend(body) {
  const lines = String(body || '').split(/\n+/).map((l) => l.replace(/^\s*[-•*]\s+/, '').trim()).filter(Boolean);
  const pieces = [];
  let header = '';
  for (const line of lines) {
    if (/:$/.test(line) && line.length <= 30) { header = line + ' '; continue; }
    const text = header + line;
    header = '';
    if (text.length <= PART_CHARS) { pieces.push(text); continue; }
    // A long paragraph: break it at sentence ends.
    let cur = '';
    for (const sentence of text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]) {
      if (cur && (cur + sentence).trim().length > PART_CHARS) { pieces.push(cur.trim()); cur = ''; }
      cur += sentence;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  if (header.trim()) pieces.push(header.trim());

  // Pack neighbours together so a short answer isn't sprayed across many texts.
  const parts = [];
  for (const piece of pieces) {
    const last = parts[parts.length - 1];
    if (last && (last + '\n' + piece).length <= PART_CHARS) parts[parts.length - 1] = last + '\n' + piece;
    else parts.push(piece);
  }
  while (parts.length > MAX_PARTS) { const tail = parts.pop(); parts[parts.length - 1] += '\n' + tail; }
  return parts;
}

const last4 = (phone) => '…' + String(phone || '').slice(-4);

async function alertOwner(subject, { sid, code, to, body, note }) {
  const rows = [['What happened', note], ['Twilio message', sid], ['Error code', code || 'none given'], ['To', last4(to)], ['Text', body || '(could not read it back)']]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('');
  await emailOwner(subject, `<table style="font-family:sans-serif;font-size:14px">${rows}</table>`);
}

/**
 * @param {object} p
 * @param {object} p.params   Twilio's status callback fields (MessageSid, MessageStatus, ErrorCode, To)
 * @param {boolean} p.retry   true when this report is about a text we already re-sent
 * @param {string} p.base     https://www.exit163.com, for the callback on the re-sent texts
 * @param {number} [p.now]
 * @returns {Promise<{action: 'ignored'|'logged'|'resent'|'duplicate'|'alerted', parts?: number}>}
 */
async function handleStatus({ params, retry = false, base, now = Date.now() }) {
  const status = String(params.MessageStatus || params.SmsStatus || '').toLowerCase();
  if (!FAILED.has(status)) return { action: 'ignored' };
  const sid = String(params.MessageSid || params.SmsSid || '');
  const code = String(params.ErrorCode || '');
  // console.error so it shows under "errors" in the Vercel logs. No phone number, no text.
  console.error(`sms not delivered sid=${sid} status=${status} code=${code || '-'}${retry ? ' (the re-send)' : ''}`);

  if (retry) {
    const msg = await getMessage(sid).catch(() => ({}));
    await alertOwner('A reply was blocked twice', { sid, code, to: msg.to || params.To, body: msg.body, note: 'A reply was not delivered, I re-sent it in shorter pieces, and this piece was not delivered either. Nothing more was sent.' });
    return { action: 'alerted' };
  }
  if (!RESEND_CODES.has(code) || !sid) return { action: 'logged' };

  const msg = await getMessage(sid);
  if (!msg.body || !msg.to) {
    await alertOwner('A reply was blocked and could not be re-sent', { sid, code, to: params.To, note: 'Twilio no longer had the text, so there was nothing to send again.' });
    return { action: 'alerted' };
  }
  const sentAt = Date.parse(msg.date_created) || now;
  if (now - sentAt > MAX_AGE_MS) {
    await alertOwner('A reply was blocked (found out too late to re-send)', { sid, code, to: msg.to, body: msg.body, note: `The carrier reported this ${Math.round((now - sentAt) / 60000)} minutes after it was sent, too late for the answer to still make sense.` });
    return { action: 'alerted' };
  }

  const parts = splitForResend(msg.body);
  // Twilio can deliver the same report twice. If the first piece already went out after the blocked text, stop.
  const recent = await recentTo(msg.to).catch(() => []);
  if (recent.some((m) => m.sid !== sid && m.body === parts[0] && String(m.direction || '').startsWith('outbound') && (Date.parse(m.date_created) || 0) >= sentAt)) {
    return { action: 'duplicate' };
  }

  const statusCallback = `${base}${STATUS_PATH}?retry=1`;
  let sent = 0;
  try {
    for (const part of parts) { await sendSms(msg.to, part, { statusCallback }); sent++; }
  } catch (e) {
    console.error('sms re-send failed', e.message);
    await alertOwner('A reply was blocked and the re-send failed', { sid, code, to: msg.to, body: msg.body, note: `Twilio refused the re-send after ${sent} of ${parts.length} pieces: ${e.message}` });
    return { action: 'alerted', parts: sent };
  }
  return { action: 'resent', parts: sent };
}

module.exports = { handleStatus, splitForResend, RESEND_CODES, MAX_AGE_MS };
