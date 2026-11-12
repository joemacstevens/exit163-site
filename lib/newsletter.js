// Newsletter signup via Resend, shared by the web form and the text buddy.
const RESEND = 'https://api.resend.com';
const SEGMENT_ID = process.env.RESEND_SEGMENT_ID || '5de278e6-d205-4fe6-97a7-6e32b794a460'; // Exit 163 Subscribers
const TOPIC_ID = process.env.RESEND_TOPIC_ID || 'ec14cccb-225f-405a-a239-e625b881fb59';     // Exit 163 Weekend Newsletter
const FROM = process.env.NEWSLETTER_FROM || 'Exit 163 <weekend@exit163.com>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function resend(path, method, body) {
  return fetch(RESEND + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function addSubscriber(email) {
  const created = await resend('/contacts', 'POST', {
    email,
    unsubscribed: false,
    segments: [{ id: SEGMENT_ID }],
    topics: [{ id: TOPIC_ID, subscription: 'opt_in' }],
  });
  if (created.ok) return { isNew: true };

  // Contact probably exists already (e.g. on another list): attach it and re-opt-in.
  const detail = await created.text();
  const enc = encodeURIComponent(email);
  const seg = await resend(`/contacts/${enc}/segments/${SEGMENT_ID}`, 'POST');
  const upd = await resend(`/contacts/${enc}`, 'PATCH', { unsubscribed: false });
  const top = await resend(`/contacts/${enc}/topics`, 'PATCH', { topics: [{ id: TOPIC_ID, subscription: 'opt_in' }] });
  if (seg.ok || upd.ok || top.ok) return { isNew: false };
  throw new Error(`Resend create failed ${created.status}: ${detail}`);
}

async function sendWelcome(email) {
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">
<p>You're in. 🚗</p>
<p>Every <strong>Friday at 7am</strong>, Exit 163 lands in your inbox with the best things to do in Bergen County this weekend: games, shows, markets, new restaurants, family picks and date nights, each with a town, day and time.</p>
<p style="background:#fff6e0;border-left:4px solid #FFB81C;padding:12px 14px">🎄 <strong>Your bonus:</strong> every Bergen tree lighting, menorah lighting &amp; holiday market for 2026, in one list.<br><a href="https://www.exit163.com/holidays?unlocked=1" style="color:#1f5e44;font-weight:700">Open the full holiday tracker →</a></p>
<p>Two quick favors so you don't miss it:</p>
<ol><li>Move this email to your <strong>Primary</strong> inbox (Gmail users: drag it over).</li>
<li>Follow along daily on Instagram: <a href="https://www.instagram.com/exit.163/">@exit.163</a></li></ol>
<p>See you Friday,<br>Exit 163</p></div>`;
  await resend('/emails', 'POST', {
    from: FROM,
    to: [email],
    subject: "You're in: your Bergen weekend, every Friday",
    html,
  });
}

module.exports = { EMAIL_RE, addSubscriber, sendWelcome };
