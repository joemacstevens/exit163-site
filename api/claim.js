// /api/claim — local businesses claim a free listing or take a town sponsor slot.
//   GET  /api/claim?town=Ridgewood           -> which sponsor slots are open
//   POST /api/claim  kind=claim   ...        -> records a listing claim, emails the owner
//   POST /api/claim  kind=sponsor ...        -> reserves the slot and sends them to Stripe Checkout
//                                               (or records the request if Stripe isn't configured)
// Env: STRIPE_SECRET_KEY + STRIPE_SPONSOR_PRICE_ID (recurring price) to take payment.
const { readBody } = require('../lib/http');
const { db, q } = require('../lib/db');
const { resolveTown, BY_SLUG } = require('../lib/towns');
const { sponsorAvailability, SPONSOR_CATEGORIES } = require('../lib/tools');
const { notifyOwner } = require('../lib/notify');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SITE = process.env.PUBLIC_BASE_URL || 'https://www.exit163.com';
const clean = (v, n = 300) => String(v ?? '').trim().slice(0, n);

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const town = req.query?.town || new URL(req.url, SITE).searchParams.get('town');
      return res.status(200).json(await sponsorAvailability({ town }));
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }

    const b = await readBody(req);
    if (b.website) return res.status(200).json({ ok: true }); // honeypot

    const townSlug = resolveTown(b.town);
    const email = clean(b.email, 254).toLowerCase();
    const business = clean(b.business, 120);
    const contact = clean(b.name, 120);
    if (!townSlug || townSlug === 'bergen-county') return res.status(400).json({ ok: false, error: 'Pick your Bergen County town.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email.' });
    if (!business || !contact) return res.status(400).json({ ok: false, error: 'Business name and your name are required.' });
    const townName = BY_SLUG.get(townSlug).name;

    if (b.kind === 'claim') {
      await q(db().from('claims').insert({
        venue_name: business, town_slug: townSlug, contact_name: contact, contact_email: email,
        contact_phone: clean(b.phone, 30) || null, role: clean(b.role, 80) || null, notes: clean(b.notes, 1000) || null,
      }));
      await notifyOwner(`Listing claim: ${business} (${townName})`, { business, town: townName, contact, email, phone: b.phone, role: b.role, notes: b.notes });
      return res.status(200).json({ ok: true, message: "Got it. We'll verify you own the business and email you within 2 business days." });
    }

    if (b.kind === 'sponsor') {
      const category = clean(b.category, 20);
      if (!SPONSOR_CATEGORIES.includes(category)) return res.status(400).json({ ok: false, error: 'Pick a category.' });
      const { open } = await sponsorAvailability({ town: townSlug });
      if (!open.includes(category)) return res.status(409).json({ ok: false, error: `The ${category} spot in ${townName} is taken. Try another category or a neighboring town.` });

      const [row] = await q(db().from('sponsorships').insert({
        town_slug: townSlug, category, business_name: business, contact_name: contact, contact_email: email,
        pitch: clean(b.pitch, 140) || null, url: clean(b.url, 300) || null, status: 'pending',
      }).select('id'));

      if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SPONSOR_PRICE_ID) {
        const session = await stripe('/v1/checkout/sessions', {
          mode: 'subscription',
          'line_items[0][price]': process.env.STRIPE_SPONSOR_PRICE_ID,
          'line_items[0][quantity]': '1',
          customer_email: email,
          client_reference_id: row.id,
          'metadata[sponsorship_id]': row.id,
          'subscription_data[metadata][sponsorship_id]': row.id,
          'subscription_data[description]': `Exit 163 sponsor: ${category}, ${townName}`,
          success_url: `${SITE}/claim?sponsor=success`,
          cancel_url: `${SITE}/claim?sponsor=canceled`,
        });
        return res.status(200).json({ ok: true, checkout_url: session.url });
      }

      await notifyOwner(`Sponsor request: ${business} for ${category} in ${townName}`, { business, town: townName, category, contact, email, pitch: b.pitch, url: b.url, note: 'Stripe not configured yet: follow up by email.' });
      return res.status(200).json({ ok: true, message: `Thanks! The ${category} spot in ${townName} is open. We'll email you to finish setup.` });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request.' });
  } catch (e) {
    console.error('claim error', e);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
};

async function stripe(path, params) {
  const r = await fetch('https://api.stripe.com' + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${out.error?.message}`);
  return out;
}
