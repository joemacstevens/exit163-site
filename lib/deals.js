// Deals ride along; they never buy a spot.
//
// The agent picks places with no knowledge of who pays: search (lib/tools.js) never reads
// venues.plan or the deals tables. Only after the reply is written does attachOffer() look at
// which places the reply names, and add at most one deal line for a place that was already
// in the answer. Nothing in this file can add, remove or reorder a recommendation.
const crypto = require('crypto');
const { db, q } = require('./db');
const { todayNJ } = require('./dates');

const DEAL_BLOCK = '\n\nDeal: ';
const EXPLAINER = ' Places pay to add a deal. It never changes what I pick.';
const RESHOW_HOURS = 24;                       // don't repeat the same deal to the same person inside this window
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const TEST_CODE = 'X163-TEST';

// Lowercase, drop apostrophes, everything else non-alphanumeric becomes one space.
const norm = (s) => ` ${String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Places from `seen` that the reply names, in the order the reply names them. */
function mentioned(reply, seen = []) {
  const hay = norm(reply);
  const hits = [];
  for (const v of seen) {
    const needle = norm(v.name);
    if (needle.trim().length < 4) continue;    // too short to match safely
    const at = hay.indexOf(needle);
    if (at !== -1) hits.push({ id: v.id, name: v.name, at });
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** Remove any "Deal:" line the model wrote itself. Only this file may add one. */
function dropModelDeals(reply) {
  return String(reply || '').split('\n').filter((l) => !/^\s*deal\s*:/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The reply as the agent wrote it, without the deal block we appended. Used for conversation history. */
function stripOffer(body) {
  const s = String(body || '');
  const at = s.indexOf(DEAL_BLOCK);
  return at === -1 ? s : s.slice(0, at);
}

function offerLine(deal, venueName, code, firstEver) {
  let what = deal.headline.trim().replace(/[.!]+$/, '');
  if (deal.first_time_only && !/first/i.test(what)) what += ' (first visit only)';
  const terms = deal.terms ? ` ${deal.terms.trim().replace(/\.+$/, '')}.` : '';
  return `${DEAL_BLOCK}${what} at ${venueName}.${terms} Show this text, code ${code}.${firstEver ? EXPLAINER : ''}`;
}

const newCode = () => 'X163-' + Array.from(crypto.randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw new Error(`db: ${error.message}`);
  return count || 0;
}

/**
 * Add at most one deal line to a finished reply.
 * @param {object} p
 * @param {string} p.reply     what the agent wrote
 * @param {Array<{id:string,name:string}>} p.seen  places search returned this turn
 * @param {string} p.phone     E.164
 * @param {string} [p.channel] 'sms' | 'test'. 'test' writes nothing and uses a fixed code.
 * @returns {Promise<string>}  the reply, with or without a deal line. Never throws.
 */
async function attachOffer({ reply, seen, phone, channel = 'sms' }) {
  const clean = dropModelDeals(reply);
  try {
    const hits = mentioned(clean, seen);
    if (!hits.length || !phone) return clean;
    const dry = channel === 'test';
    const ids = hits.map((h) => h.id);

    if (!dry) await q(db().from('venue_mentions').insert(ids.map((venue_id) => ({ venue_id, channel }))));

    // Which of the named places are verified and on the deals plan?
    const payers = await q(db().from('venues').select('id').in('id', ids).eq('plan', 'deals').not('owner_verified_at', 'is', null));
    if (!payers.length) return clean;
    const today = todayNJ();
    const deals = await q(db().from('deals').select('id,venue_id,headline,terms,first_time_only,redemption_cap')
      .in('venue_id', payers.map((v) => v.id)).eq('status', 'active').lte('starts_on', today)
      .or(`ends_on.is.null,ends_on.gte.${today}`));
    if (!deals.length) return clean;
    const dealFor = new Map(deals.map((d) => [d.venue_id, d]));

    for (const hit of hits) {            // the order the agent named them
      const deal = dealFor.get(hit.id);
      if (!deal) continue;
      if (dry) return clean + offerLine(deal, hit.name, TEST_CODE, false);

      const [mine] = await q(db().from('deal_offers').select('code,last_shown_at').eq('deal_id', deal.id).eq('phone', phone));
      if (mine) {
        if (Date.now() - new Date(mine.last_shown_at).getTime() < RESHOW_HOURS * 3600e3) return clean; // it's already in their thread
        await q(db().from('deal_offers').update({ last_shown_at: new Date().toISOString() }).eq('code', mine.code));
        return clean + offerLine(deal, hit.name, mine.code, false);
      }
      if (deal.redemption_cap) {
        const given = await countRows(db().from('deal_offers').select('code', { count: 'exact', head: true }).eq('deal_id', deal.id));
        if (given >= deal.redemption_cap) continue;   // this one is used up; a later place may still have one
      }
      const earlier = await countRows(db().from('deal_offers').select('code', { count: 'exact', head: true }).eq('phone', phone));
      let code;
      for (let tries = 0; tries < 4 && !code; tries++) {
        const candidate = newCode();
        const { error } = await db().from('deal_offers').insert({ code: candidate, deal_id: deal.id, phone, channel });
        if (!error) code = candidate;
        else if (!/duplicate|unique/i.test(error.message)) throw new Error(`db: ${error.message}`);
      }
      if (!code) return clean;
      return clean + offerLine(deal, hit.name, code, earlier === 0);   // one deal per answer
    }
    return clean;
  } catch (e) {
    console.error('attachOffer', e.message);
    return clean;                         // a deal problem must never cost someone their answer
  }
}

/** Delete every code tied to a phone number (for FORGET). */
async function forgetPhone(phone) {
  await q(db().from('deal_offers').delete().eq('phone', phone));
}

module.exports = { attachOffer, stripOffer, mentioned, dropModelDeals, offerLine, forgetPhone, DEAL_BLOCK, TEST_CODE };
