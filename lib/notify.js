// Email the owner about new claims / sponsor sign-ups (via Resend).
const NOTIFY_TO = process.env.NOTIFY_EMAIL || 'joemac79@gmail.com';
const FROM = process.env.NEWSLETTER_FROM || 'Exit 163 <weekend@exit163.com>';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function notifyOwner(subject, fields) {
  if (!process.env.RESEND_API_KEY) return console.warn('notifyOwner: RESEND_API_KEY missing');
  const rows = Object.entries(fields).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [NOTIFY_TO], subject: `[Exit 163] ${subject}`, html: `<table style="font-family:sans-serif;font-size:14px">${rows}</table>` }),
  });
  if (!r.ok) console.error('notifyOwner failed', r.status, await r.text());
}

module.exports = { notifyOwner };
