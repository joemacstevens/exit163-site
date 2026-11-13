// /api/review — the private review queue behind /review. One person, one token.
// Auth: header "Authorization: Bearer <ADMIN_TOKEN>" (the same token /api/blast uses).
//   GET  /api/review                       -> { claims, drafts, tickets }
//   POST /api/review { action, ... }
//     claim.approve  { id, venue_id | null, category?, apply? }  confirm the owner, apply listing changes, publish the claim's drafts
//     claim.reject   { id }                                       mark rejected and delete the claim's drafts
//     claim.reread   { id }                                       read the note again (replaces the claim's drafts)
//     event.save     { id, fields }                               edit a draft
//     event.publish  { id }                                       publish a draft that is not waiting on a claim
//     event.discard  { id }                                       delete a draft
//     ticket.set     { id, status }                               researching | added | dismissed
// Only drafts can be edited or deleted here. Published rows are out of reach on purpose.
const crypto = require('crypto');
const { readBody } = require('../lib/http');
const { db, q } = require('../lib/db');
const { BY_SLUG, resolveTown } = require('../lib/towns');
const { readAndSave, ownerNote, EVENT_CATS } = require('../lib/claim-notes');

const PLACE_CATS = ['food', 'family', 'nightlife', 'shopping', 'arts', 'outdoors', 'services'];
const TICKET_STATUSES = ['new', 'researching', 'added', 'dismissed'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_COLS = 'id,title,town_slug,venue_id,location,category,tags,starts_on,ends_on,recurrence_text,time_text,cost_text,description,source_url,origin,claim_id,created_at';
const CLAIM_COLS = 'id,venue_id,venue_name,town_slug,contact_name,contact_email,contact_phone,role,notes,status,created_at';
const VENUE_COLS = 'id,name,town_slug,address,category,website,phone,hours_text,opened_on,status,claimed,claimed_by_email';
const MISSING = /PGRST20[45]|42703|42P01|schema cache|does not exist/i;

const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null);
const date = (v) => (YMD.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? String(v) : null);
const townName = (slug) => BY_SLUG.get(slug)?.name || slug || '';
const uuid = (v, what) => { if (!UUID.test(String(v || ''))) throw fail(400, `Missing or bad ${what}.`); return String(v); };

function authorized(req) {
  const token = process.env.ADMIN_TOKEN;
  const sent = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !sent) return false;
  const h = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(sent), h(token));
}

function e164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

function website(v) {
  const s = str(v, 300);
  if (!s) return null;
  const full = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { return new URL(full).hostname.includes('.') ? full : null; } catch { return null; }
}

// ---------- matching a claim to a place we already list ----------
const NOISE = new Set(['the', 'and', 'of', 'at', 'llc', 'inc', 'co', 'nj']);
const words = (name) => String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w));
function likeness(a, b) {
  const A = words(a); const B = new Set(words(b));
  if (!A.length || !B.size) return 0;
  return A.filter((w) => B.has(w)).length / Math.min(A.length, B.size);
}

// ---------- GET ----------
async function queue() {
  let migrationPending = false;
  let claims;
  const withReading = await db().from('claims').select(`${CLAIM_COLS},reading`).eq('status', 'pending').order('created_at', { ascending: false }).limit(100);
  if (withReading.error) {
    if (!MISSING.test(`${withReading.error.code || ''} ${withReading.error.message}`)) throw new Error(`db: ${withReading.error.message}`);
    migrationPending = true;
    claims = await q(db().from('claims').select(CLAIM_COLS).eq('status', 'pending').order('created_at', { ascending: false }).limit(100));
  } else claims = withReading.data;

  let drafts = [];
  if (!migrationPending) drafts = await q(db().from('events').select(EVENT_COLS).eq('status', 'draft').order('starts_on', { ascending: true, nullsFirst: false }).limit(300));

  const towns = [...new Set(claims.map((c) => c.town_slug).filter(Boolean))];
  const venues = towns.length ? await q(db().from('venues').select(VENUE_COLS).in('town_slug', towns).limit(2000)) : [];

  let tickets = [];
  const t = await db().from('research_tickets').select('id,kind,channel,town_slug,category,summary,details,status,created_at').in('status', ['new', 'researching']).order('created_at', { ascending: false }).limit(100);
  if (t.error) { if (!MISSING.test(`${t.error.code || ''} ${t.error.message}`)) throw new Error(`db: ${t.error.message}`); } else tickets = t.data;

  const pendingIds = new Set(claims.map((c) => c.id));
  const shapeEvent = (e) => ({ ...e, town: townName(e.town_slug) });
  return {
    ok: true,
    migration_pending: migrationPending,
    claims: claims.map((c) => {
      const matches = venues.filter((v) => v.town_slug === c.town_slug)
        .map((v) => ({ ...v, score: v.id === c.venue_id ? 2 : likeness(c.venue_name, v.name) }))
        .filter((v) => v.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 5);   // generous: a missed match becomes a duplicate place
      const reading = c.reading || null;
      return {
        id: c.id, business: c.venue_name, town: townName(c.town_slug), town_slug: c.town_slug,
        contact: c.contact_name, role: c.role, email: c.contact_email, phone: c.contact_phone,
        wants_deals: /^\[Wants deals\]/.test(c.notes || ''), note: ownerNote(c.notes), created_at: c.created_at,
        read: Boolean(reading), listing: reading?.venue || {}, other: reading?.other || [], skipped: reading?.skipped || [],
        events: drafts.filter((e) => e.claim_id === c.id).map((e) => ({ ...shapeEvent(e), check: reading?.checks?.[e.id] || null })),
        matches: matches.map(({ score, ...v }) => ({ ...v, exact: score >= 1 })),
      };
    }),
    drafts: drafts.filter((e) => !pendingIds.has(e.claim_id)).map(shapeEvent),
    tickets: tickets.map((x) => ({ ...x, town: townName(x.town_slug) })),
    categories: { event: EVENT_CATS, place: PLACE_CATS },
  };
}

// ---------- POST actions ----------
async function pendingClaim(id) {
  const [claim] = await q(db().from('claims').select(CLAIM_COLS).eq('id', uuid(id, 'claim id')).limit(1));
  if (!claim) throw fail(404, 'That claim is gone.');
  if (claim.status !== 'pending') throw fail(409, `That claim was already ${claim.status}.`);
  return claim;
}

/** Listing fields a reviewer chose to apply. Empty means "leave it as it is". */
function listingPatch(apply = {}) {
  const patch = {};
  const put = (k, v) => { if (v != null) patch[k] = v; };
  put('hours_text', str(apply.hours_text, 200));
  put('address', str(apply.address, 200));
  put('phone', str(apply.phone, 30));
  put('description', str(apply.description, 500));
  if (str(apply.website, 300)) { const w = website(apply.website); if (!w) throw fail(400, 'That website does not look like a web address.'); patch.website = w; }
  if (str(apply.opened_on, 20)) { const d = date(apply.opened_on); if (!d) throw fail(400, 'Opening date should look like 2026-12-05.'); patch.opened_on = d; }
  if (apply.status === 'coming_soon' || apply.status === 'open') patch.status = apply.status;
  return patch;
}

const actions = {
  async 'claim.approve'(b) {
    const claim = await pendingClaim(b.id);
    const patch = listingPatch(b.apply);

    // 1. The place: one we already list, or a new one.
    let venue;
    if (b.venue_id) {
      [venue] = await q(db().from('venues').select(VENUE_COLS).eq('id', uuid(b.venue_id, 'place id')).limit(1));
      if (!venue) throw fail(404, 'That place is gone. Reload and pick again.');
      if (venue.claimed && venue.claimed_by_email && venue.claimed_by_email !== claim.contact_email && !b.replace_owner) {
        throw fail(409, `${venue.name} is already claimed by ${venue.claimed_by_email}. Approve again to replace them.`);
      }
    } else {
      if (!PLACE_CATS.includes(b.category)) throw fail(400, 'Pick a category for the new place.');
      const made = await db().from('venues').insert({ name: claim.venue_name, town_slug: claim.town_slug, category: b.category, origin: 'venue' }).select(VENUE_COLS);
      if (made.error && made.error.code !== '23505') throw new Error(`db: ${made.error.message}`);
      venue = made.data?.[0] || (await q(db().from('venues').select(VENUE_COLS).eq('name', claim.venue_name).eq('town_slug', claim.town_slug).limit(1)))[0];
      if (!venue) throw new Error('Could not create the place.');
    }

    // 2. Owner confirmed (the same fields scripts/partner.js "verify" sets), plus any listing changes.
    const now = new Date().toISOString();
    const phone = e164(claim.contact_phone);
    await q(db().from('venues').update({
      ...patch, claimed: true, claimed_by_email: claim.contact_email, owner_verified_at: now, ...(phone ? { owner_phone: phone } : {}), updated_at: now,
    }).eq('id', venue.id));

    // 3. The claim's drafts go live, tied to the place. The owner told us, so they count as confirmed.
    const link = patch.website || venue.website;
    await q(db().from('events').update({ location: venue.name }).eq('claim_id', claim.id).eq('status', 'draft').is('location', null));
    if (link) await q(db().from('events').update({ source_url: link }).eq('claim_id', claim.id).eq('status', 'draft').is('source_url', null));
    const published = await q(db().from('events').update({ status: 'published', verified: true, venue_id: venue.id, updated_at: now })
      .eq('claim_id', claim.id).eq('status', 'draft').select('id'));

    // 4. Last, so a failure above leaves the claim pending and safe to approve again.
    await q(db().from('claims').update({ status: 'approved', venue_id: venue.id }).eq('id', claim.id));
    return { message: `${venue.name} approved. ${published.length} event${published.length === 1 ? '' : 's'} published.`, venue_id: venue.id };
  },

  async 'claim.reject'(b) {
    const claim = await pendingClaim(b.id);
    const gone = await q(db().from('events').delete().eq('claim_id', claim.id).eq('status', 'draft').select('id'));
    await q(db().from('claims').update({ status: 'rejected' }).eq('id', claim.id));
    return { message: `${claim.venue_name} rejected. ${gone.length} draft${gone.length === 1 ? '' : 's'} deleted.` };
  },

  async 'claim.reread'(b) {
    const claim = await pendingClaim(b.id);
    if (!ownerNote(claim.notes)) throw fail(400, 'That claim has no note to read.');
    const read = await readAndSave(claim);
    if (!read) throw fail(502, 'The note could not be read just now. Try again in a minute.');
    return { message: `Read again: ${read.saved} draft${read.saved === 1 ? '' : 's'}.` };
  },

  async 'event.save'(b) {
    const f = b.fields || {};
    const patch = { updated_at: new Date().toISOString() };
    if ('title' in f) { patch.title = str(f.title, 200); if (!patch.title) throw fail(400, 'An event needs a title.'); }
    for (const [k, n] of [['location', 300], ['recurrence_text', 120], ['time_text', 120], ['cost_text', 120], ['description', 600]]) if (k in f) patch[k] = str(f[k], n);
    for (const k of ['starts_on', 'ends_on']) {
      if (!(k in f)) continue;
      patch[k] = str(f[k], 20) ? date(f[k]) : null;
      if (str(f[k], 20) && !patch[k]) throw fail(400, 'Dates should look like 2026-12-05.');
    }
    if (patch.starts_on && patch.ends_on && patch.ends_on <= patch.starts_on) patch.ends_on = null;
    if ('category' in f) { if (!EVENT_CATS.includes(f.category)) throw fail(400, 'Unknown category.'); patch.category = f.category; }
    if ('town_slug' in f) { patch.town_slug = resolveTown(f.town_slug); if (!patch.town_slug) throw fail(400, 'Unknown town.'); }
    const saved = await db().from('events').update(patch).eq('id', uuid(b.id, 'event id')).eq('status', 'draft').select(EVENT_COLS);
    if (saved.error) throw saved.error.code === '23505' ? fail(409, 'There is already an event with that title and date in that town.') : new Error(`db: ${saved.error.message}`);
    if (!saved.data.length) throw fail(404, 'That draft is gone (published or deleted).');
    return { message: 'Saved.', event: saved.data[0] };
  },

  async 'event.publish'(b) {
    const [ev] = await q(db().from('events').select('id,title,claim_id,status').eq('id', uuid(b.id, 'event id')).limit(1));
    if (!ev || ev.status !== 'draft') throw fail(404, 'That draft is gone (published or deleted).');
    if (ev.claim_id) {
      const [claim] = await q(db().from('claims').select('status').eq('id', ev.claim_id).limit(1));
      if (claim?.status === 'pending') throw fail(409, 'This draft belongs to a claim that is still waiting. Approve the claim to publish it.');
    }
    await q(db().from('events').update({ status: 'published', updated_at: new Date().toISOString() }).eq('id', ev.id).eq('status', 'draft'));
    return { message: `Published: ${ev.title}.` };
  },

  async 'event.discard'(b) {
    const gone = await q(db().from('events').delete().eq('id', uuid(b.id, 'event id')).eq('status', 'draft').select('title'));
    if (!gone.length) throw fail(404, 'That draft is gone (published or deleted).');
    return { message: `Deleted draft: ${gone[0].title}.` };
  },

  async 'ticket.set'(b) {
    if (!TICKET_STATUSES.includes(b.status)) throw fail(400, 'Unknown status.');
    const id = Number(b.id);
    if (!Number.isInteger(id)) throw fail(400, 'Missing or bad ticket id.');
    const set = await q(db().from('research_tickets').update({ status: b.status }).eq('id', id).select('id'));
    if (!set.length) throw fail(404, 'That ticket is gone.');
    return { message: b.status === 'added' ? 'Marked as added.' : b.status === 'dismissed' ? 'Dismissed.' : 'Updated.' };
  },
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    if (req.method === 'GET') return res.status(200).json(await queue());
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
    const b = await readBody(req);
    const run = Object.hasOwn(actions, b.action) ? actions[b.action] : null;
    if (!run) return res.status(400).json({ ok: false, error: 'Unknown action.' });
    return res.status(200).json({ ok: true, ...(await run(b)) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('review error', e);
    return res.status(500).json({ ok: false, error: `Something went wrong: ${e.message}` });
  }
};

module.exports.likeness = likeness;
module.exports.listingPatch = listingPatch;
