// POST /api/stripe-webhook — turns paid checkouts into active sponsorships.
// Stripe Dashboard -> Developers -> Webhooks -> endpoint https://www.exit163.com/api/stripe-webhook
// Events: checkout.session.completed, customer.subscription.deleted
// Env: STRIPE_WEBHOOK_SECRET (whsec_...)
const crypto = require('crypto');
const { db, q } = require('../lib/db');
const { notifyOwner } = require('../lib/notify');

async function rawBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

function verify(raw, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const raw = await rawBody(req);
  if (!process.env.STRIPE_WEBHOOK_SECRET || !verify(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).send('Bad signature');
  }
  const event = JSON.parse(raw);
  const obj = event.data?.object || {};

  try {
    if (event.type === 'checkout.session.completed') {
      const id = obj.metadata?.sponsorship_id || obj.client_reference_id;
      if (id) {
        const { error } = await db().from('sponsorships').update({
          status: 'active', starts_at: new Date().toISOString(),
          stripe_customer_id: obj.customer || null, stripe_subscription_id: obj.subscription || null,
        }).eq('id', id);
        const [s] = await q(db().from('sponsorships').select('business_name,town_slug,category,contact_email').eq('id', id));
        if (error) {
          // Most likely someone else took the slot between reserve and payment.
          await notifyOwner('ACTION NEEDED: paid sponsor could not be activated (slot taken?) — refund or move them', { id, ...s, error: error.message });
        } else {
          await notifyOwner(`New sponsor live: ${s?.business_name} (${s?.category}, ${s?.town_slug})`, { id, ...s });
        }
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      await q(db().from('sponsorships').update({ status: 'canceled', ends_at: new Date().toISOString() }).eq('stripe_subscription_id', obj.id));
    }
  } catch (e) {
    console.error('stripe webhook', e);
    return res.status(500).send('error');
  }
  return res.status(200).json({ received: true });
};

module.exports = handler;
