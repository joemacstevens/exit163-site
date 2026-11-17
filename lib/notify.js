// Email the owner about new claims / sponsor sign-ups (via Resend).
const NOTIFY_TO = process.env.NOTIFY_EMAIL || 'joemac79@gmail.com';
const FROM = process.env.NEWSLETTER_FROM || 'Exit 163 <weekend@exit163.com>';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// On Joe's Mac there is no API key in .env.local; mail goes through the logged-in Resend CLI
// instead (the same one the weekly runbook uses). On the server the key is always set.
function viaCli(subject, html) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cli = path.join(os.homedir(), '.resend', 'bin', 'resend');
  if (!fs.existsSync(cli)) { console.warn('emailOwner: no RESEND_API_KEY and no Resend CLI'); return false; }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exit163-mail-')), 'body.html');
  fs.writeFileSync(file, html);
  try {
    require('child_process').execFileSync(cli, ['emails', 'send', '-q', '--from', FROM, '--to', NOTIFY_TO, '--subject', `[Exit 163] ${subject}`, '--html-file', file], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    return true;
  } catch (e) { console.error('emailOwner (Resend CLI) failed', String(e.stderr || e.message).slice(0, 300)); return false; }
  finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

// Send the owner one email. Resolves true when Resend accepted it; never throws.
async function emailOwner(subject, html) {
  if (!process.env.RESEND_API_KEY) return viaCli(subject, html);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [NOTIFY_TO], subject: `[Exit 163] ${subject}`, html }),
    });
    if (!r.ok) console.error('emailOwner failed', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('emailOwner failed', e.message); return false; }
}

async function notifyOwner(subject, fields) {
  const rows = Object.entries(fields).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  await emailOwner(subject, `<table style="font-family:sans-serif;font-size:14px">${rows}</table>`);
}

module.exports = { notifyOwner, emailOwner, esc };
