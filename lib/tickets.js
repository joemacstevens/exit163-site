// Research tickets: things the text line learned it should go find out.
//   lead = a promoter, DJ, venue or organizer told us about their event or place
//   gap  = someone asked for something we had nothing for
// Rows carry what was said about the event or the ask, never who said it (no phone, no name,
// no email), the same rule as the queries table. Reviewed in the weekly research routine.
// The table comes from db/migrations/2026-11-12-research-tickets.sql; until that is applied,
// saving is a quiet no-op so the text line keeps working.
const { db } = require('./db');
const { resolveTown } = require('./towns');

const KINDS = ['lead', 'gap'];
const CATEGORIES = ['family', 'food', 'nightlife', 'arts', 'sports', 'holiday', 'outdoors', 'shopping', 'community', 'other'];
const MISSING = /research_tickets.*(does not exist|schema cache)|PGRST205|42P01/i;

// Emails and phone numbers never go in a ticket, even if the model copies them over.
// A public handle like @djname is left alone: it's how research finds the event.
const scrub = (s, n) => String(s || '').replace(/\s+/g, ' ')
  .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[email removed]')
  .replace(/\+?\d?[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/g, '[number removed]')
  .trim().slice(0, n);

let tableMissing = false; // set once per process so we don't retry a table that isn't there yet

/**
 * @param {{kind:string, summary:string, details?:string, town?:string, category?:string}} t
 * @param {string} channel  'sms' | 'test' ...
 * @returns {Promise<{noted:boolean, id?:number}>}  always resolves; the agent never needs to know if storage failed.
 *   id is the new row's id when it was saved (lib/followups.js links a follow-up to it).
 */
async function note(t = {}, channel = 'sms') {
  const summary = scrub(t.summary, 300);
  if (!summary) return { noted: false };
  if (tableMissing) return { noted: true };
  const row = {
    kind: KINDS.includes(t.kind) ? t.kind : 'gap',
    channel,
    town_slug: t.town ? resolveTown(t.town) : null,
    category: CATEGORIES.includes(t.category) ? t.category : null,
    summary,
    details: scrub(t.details, 600) || null,
  };
  try {
    const { data, error } = await db().from('research_tickets').insert(row).select('id').single();
    if (!error && data) return { noted: true, id: data.id };
    if (error) {
      if (MISSING.test(`${error.code || ''} ${error.message}`)) {
        tableMissing = true;
        console.warn('research_tickets table not found; apply db/migrations/2026-11-12-research-tickets.sql to start saving leads and gaps');
      } else console.error('research ticket', error.message);
    }
  } catch (e) { console.error('research ticket', e.message); }
  return { noted: true };
}

module.exports = { note, scrub, KINDS, CATEGORIES };
