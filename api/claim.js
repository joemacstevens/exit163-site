// /api/claim — local businesses claim a free listing.
//   POST /api/claim  kind=claim ...  -> records a listing claim, emails the owner.
//   offers=yes marks the claimant as wanting to hear when paid deals open.
const { readBody } = require('../lib/http');
const { db, q } = require('../lib/db');
const { resolveTown, BY_SLUG } = require('../lib/towns');
const { notifyOwner } = require('../lib/notify');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, n = 300) => String(v ?? '').trim().slice(0, n);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }

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
      const wantsOffers = b.offers === 'yes' || b.offers === true;
      const notes = [wantsOffers ? '[Wants deals]' : '', clean(b.notes, 1000)].filter(Boolean).join(' ');
      await q(db().from('claims').insert({
        venue_name: business, town_slug: townSlug, contact_name: contact, contact_email: email,
        contact_phone: clean(b.phone, 30) || null, role: clean(b.role, 80) || null, notes: notes || null,
      }));
      await notifyOwner(`Listing claim: ${business} (${townName})${wantsOffers ? ' - wants deals' : ''}`, { business, town: townName, contact, email, phone: b.phone, role: b.role, notes: b.notes, wants_deals: wantsOffers ? 'yes' : 'no' });
      return res.status(200).json({ ok: true, message: "Got it. We'll check that it's yours and email you within 2 business days." });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request.' });
  } catch (e) {
    console.error('claim error', e);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
};
