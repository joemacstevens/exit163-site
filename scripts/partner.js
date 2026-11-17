// Run the Deals tier by hand: confirm an owner, put a place on the deals plan, add a deal,
// mark a code redeemed, and pull the numbers for a place.
//
//   node --env-file=.env.local scripts/partner.js find "little fern"
//   node --env-file=.env.local scripts/partner.js verify <venue_id> --email owner@place.com [--phone 2015550163]
//   node --env-file=.env.local scripts/partner.js plan <venue_id> deals        # or: free
//   node --env-file=.env.local scripts/partner.js deal <venue_id> "$25 off your first visit" [--first-time] [--terms "Dine-in only"] [--ends 2027-01-31] [--cap 50]
//   node --env-file=.env.local scripts/partner.js pause <venue_id>             # or: end
//   node --env-file=.env.local scripts/partner.js redeem X163-7KQ4
//   node --env-file=.env.local scripts/partner.js stats <venue_id> [--days 30]
//
// A deal only shows when the place is verified, on the deals plan, and the deal is active and in date.
const { db, q } = require('../lib/db');
const { todayNJ } = require('../lib/dates');

// Carriers restrict texts about these; keep them out of deal copy.
const RESTRICTED = /\b(beer|wine|cocktails?|drinks?|shots?|liquor|booze|happy hour|vape|tobacco|cigar|cbd|cannabis|weed|casino|bet(ting)?)\b/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opt[key] = true;
    else { opt[key] = next; i++; }
  }
  return { pos, opt };
}

const fail = (msg) => { throw new Error(msg); };
const e164 = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return fail(`"${v}" is not a US phone number.`);
};

async function venue(id) {
  if (!id) fail('Give a venue id. Use "find" to look one up.');
  const [v] = await q(db().from('venues').select('id,name,town_slug,category,plan,owner_verified_at,claimed_by_email,owner_phone').eq('id', id));
  return v || fail(`No venue with id ${id}.`);
}

const COMMANDS = {
  async find({ pos }) {
    const term = pos[0] || fail('Give part of the name.');
    const rows = await q(db().from('venues').select('id,name,town_slug,category,plan,owner_verified_at').ilike('name', `%${term}%`).limit(20));
    if (!rows.length) return console.log('No match.');
    for (const v of rows) console.log(`${v.id}  ${v.name} (${v.town_slug}, ${v.category})  plan=${v.plan}  verified=${v.owner_verified_at ? 'yes' : 'no'}`);
  },

  async verify({ pos, opt }) {
    const v = await venue(pos[0]);
    if (typeof opt.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(opt.email)) fail('Add --email with the owner\'s address.');
    const patch = { owner_verified_at: new Date().toISOString(), claimed: true, claimed_by_email: opt.email.toLowerCase() };
    if (typeof opt.phone === 'string') patch.owner_phone = e164(opt.phone);
    await q(db().from('venues').update(patch).eq('id', v.id));
    console.log(`${v.name}: owner confirmed (${patch.claimed_by_email}${patch.owner_phone ? ', ' + patch.owner_phone : ''}).`);
  },

  async plan({ pos }) {
    const v = await venue(pos[0]);
    const plan = pos[1];
    if (!['free', 'deals'].includes(plan)) fail('Plan is "free" or "deals".');
    await q(db().from('venues').update({ plan }).eq('id', v.id));
    if (plan === 'free') await q(db().from('deals').update({ status: 'paused' }).eq('venue_id', v.id).eq('status', 'active'));
    console.log(`${v.name}: plan is now ${plan}.${plan === 'free' ? ' Any active deal was paused.' : ''}${plan === 'deals' && !v.owner_verified_at ? ' Not verified yet, so no deal will show. Run "verify" first.' : ''}`);
  },

  async deal({ pos, opt }) {
    const v = await venue(pos[0]);
    const headline = String(pos[1] || '').trim();
    const terms = typeof opt.terms === 'string' ? opt.terms.trim() : null;
    if (headline.length < 3 || headline.length > 80) fail('Give the deal in 3 to 80 characters, in quotes.');
    if (terms && terms.length > 60) fail('Keep --terms to 60 characters.');
    if (!opt['allow-restricted'] && RESTRICTED.test(`${headline} ${terms || ''}`)) fail('That copy mentions alcohol, tobacco, cannabis or gambling, which carriers restrict in texts. Reword it, or add --allow-restricted if you are sure.');
    if (opt.ends !== undefined && !YMD.test(opt.ends)) fail('--ends is a date like 2027-01-31.');
    if (opt.ends && opt.ends < todayNJ()) fail('--ends is in the past.');
    const cap = opt.cap === undefined ? null : Number(opt.cap);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) fail('--cap is a whole number of codes.');

    await q(db().from('deals').update({ status: 'ended' }).eq('venue_id', v.id).eq('status', 'active'));
    const [row] = await q(db().from('deals').insert({
      venue_id: v.id, headline, terms, first_time_only: Boolean(opt['first-time']), ends_on: opt.ends || null, redemption_cap: cap,
    }).select('id'));
    console.log(`${v.name}: deal is live (${row.id}).`);
    console.log(`  People will see:  Deal: ${headline}${opt['first-time'] && !/first/i.test(headline) ? ' (first visit only)' : ''} at ${v.name}.${terms ? ' ' + terms.replace(/\.+$/, '') + '.' : ''} Show this text, code X163-XXXX.`);
    if (v.plan !== 'deals' || !v.owner_verified_at) console.log(`  It will not show yet: ${[v.plan !== 'deals' && 'the place is not on the deals plan', !v.owner_verified_at && 'the owner is not verified'].filter(Boolean).join(' and ')}.`);
  },

  async pause({ pos }) { await setStatus(pos[0], 'paused'); },
  async end({ pos }) { await setStatus(pos[0], 'ended'); },

  async redeem({ pos }) {
    const code = String(pos[0] || '').trim().toUpperCase() || fail('Give the code, like X163-7KQ4.');
    const [o] = await q(db().from('deal_offers').select('code,deal_id,redeemed_at').eq('code', code));
    if (!o) fail(`No code ${code}.`);
    if (o.redeemed_at) return console.log(`${code} was already redeemed on ${o.redeemed_at.slice(0, 10)}.`);
    await q(db().from('deal_offers').update({ redeemed_at: new Date().toISOString() }).eq('code', code));
    const [d] = await q(db().from('deals').select('headline,venue_id').eq('id', o.deal_id));
    console.log(`${code} redeemed (${d ? d.headline : 'deal'}).`);
  },

  async stats({ pos, opt }) {
    const v = await venue(pos[0]);
    const days = Number(opt.days) || 30;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const count = async (query) => { const { count: n, error } = await query; if (error) fail(error.message); return n || 0; };
    const dealRows = await q(db().from('deals').select('id,headline,status,starts_on,ends_on,redemption_cap').eq('venue_id', v.id).order('created_at', { ascending: false }));
    const dealIds = dealRows.map((d) => d.id);
    const mentions = await count(db().from('venue_mentions').select('id', { count: 'exact', head: true }).eq('venue_id', v.id).gte('created_at', since));
    const given = dealIds.length ? await count(db().from('deal_offers').select('code', { count: 'exact', head: true }).in('deal_id', dealIds).gte('created_at', since)) : 0;
    const redeemed = dealIds.length ? await count(db().from('deal_offers').select('code', { count: 'exact', head: true }).in('deal_id', dealIds).gte('redeemed_at', since)) : 0;
    console.log(`${v.name} (${v.town_slug}) — last ${days} days`);
    console.log(`  plan: ${v.plan}   owner verified: ${v.owner_verified_at ? v.owner_verified_at.slice(0, 10) : 'no'}`);
    console.log(`  recommended:    ${mentions} times`);
    console.log(`  deal codes out: ${given}`);
    console.log(`  redeemed:       ${redeemed}`);
    for (const d of dealRows) console.log(`  deal [${d.status}] ${d.headline}  ${d.starts_on}${d.ends_on ? ' to ' + d.ends_on : ''}${d.redemption_cap ? `  cap ${d.redemption_cap}` : ''}`);
  },
};

async function setStatus(id, status) {
  const v = await venue(id);
  const rows = await q(db().from('deals').update({ status }).eq('venue_id', v.id).eq('status', 'active').select('id'));
  console.log(rows.length ? `${v.name}: deal ${status}.` : `${v.name} has no active deal.`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!COMMANDS[cmd]) fail(`Commands: ${Object.keys(COMMANDS).join(', ')}. See the top of scripts/partner.js.`);
  await COMMANDS[cmd](parse(rest));
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { main, parse, RESTRICTED };
