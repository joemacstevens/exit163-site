// POST /api/sms-status — Twilio's delivery report for a text the buddy sent.
// Nothing to set up in the Twilio console: every reply from /api/sms names this URL itself.
// A reply a carrier blocked is re-sent once in shorter pieces; a second block emails the owner.
// Details: lib/delivery.js. Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, RESEND_API_KEY.
const { readBody } = require('../lib/http');
const { validSignature, publicBase } = require('../lib/twilio');
const { handleStatus } = require('../lib/delivery');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method not allowed'); }
  const params = await readBody(req);

  if (process.env.SKIP_TWILIO_SIGNATURE !== '1' && !validSignature(req, params)) {
    return res.status(403).send('Invalid signature');
  }

  try {
    const retry = new URL(req.url, 'http://x').searchParams.get('retry') === '1';
    await handleStatus({ params, retry, base: publicBase(req) });
  } catch (e) {
    console.error('sms-status error', e);
  }
  // Always 204: an error here must not make Twilio send the report again and risk a second re-send.
  return res.status(204).end();
};
