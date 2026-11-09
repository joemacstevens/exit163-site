// POST /api/sms — Twilio inbound-message webhook for the Exit 163 text line.
// Twilio: Phone Number -> Messaging -> "A message comes in" -> https://www.exit163.com/api/sms (POST)
// Env: TWILIO_AUTH_TOKEN (signature check), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY.
const { readBody } = require('../lib/http');
const { validSignature, twiml } = require('../lib/twilio');
const { handleInbound } = require('../lib/conversation');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method not allowed'); }
  const params = await readBody(req);

  if (process.env.SKIP_TWILIO_SIGNATURE !== '1' && !validSignature(req, params)) {
    return res.status(403).send('Invalid signature');
  }

  try {
    const { reply } = await handleInbound({
      phone: String(params.From || '').trim(),
      text: params.Body,
      optOutType: params.OptOutType,
      channel: 'sms',
    });
    return twiml(res, reply);
  } catch (e) {
    console.error('sms error', e);
    return twiml(res, "Sorry, I hit a snag. Try again in a minute, or check exit163.com for this weekend's picks.");
  }
};
