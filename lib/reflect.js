// Nightly memory review: reread each active texter's recent messages next to what we
// remember about them, then add what the chat agent missed and drop what's no longer true.
// Runs from api/reflect.js (Vercel cron) or scripts/reflect.js (by hand, with --dry-run).
const Anthropic = require('@anthropic-ai/sdk');
const { db, q } = require('./db');
const memory = require('./memory');
const { todayNJ } = require('./dates');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
let client;
const anthropic = () => (client ||= new Anthropic());

const SYSTEM = `You maintain the memory for Exit 163, a Bergen County, NJ text line that recommends things to do on the weekend. You'll get what we currently remember about one texter and their recent messages. Decide what to add and what to remove so the next recommendations fit them better.

Add a fact only when the messages support it:
- kid: one item per child, with kid_age as of today and fact left as "kid" unless there's real context ("plays hockey"). Never a child's name.
- interest: things they clearly like or keep asking about ("live music", "comedy", "date nights", "craft fairs"). Two or more questions about the same kind of thing, or saying they loved something, counts. One passing question doesn't.
- dislike, food, budget, schedule, access: only if they said so. Word access and budget as what to look for ("step-free venues", "free or cheap"), never as a condition or a hardship ("wheelchair user", "tight budget").
- Only lasting facts about the texter and the people they regularly go out with (partner, kids). Nothing about a one-time guest or someone they were planning for (a visiting mom, a friend's party), no one-off occasions, and no ages or birthdays other than kids' ages.
- Their town ("in", "near", "from", "coming from" a Bergen County town) is not a fact; it is stored separately, so leave it out.
- other: something useful that fits nowhere else, e.g. "moving to Fair Lawn soon".
Keep each fact to a few words. Don't add what's already remembered, even in other words.

Remove a fact (by id) when the messages say it changed or was wrong, or when it duplicates another fact.

If there are older free-text notes, turn everything useful in them into facts; they get deleted after this.

Never record health, religion, politics, money trouble, relationship details, last names, addresses, phone numbers or emails. Messages Exit 163 sent (marked "Exit 163") are context only: what we suggested is not what they like unless they responded warmly to it. If nothing needs changing, return empty lists.`;

const SCHEMA = {
  type: 'object',
  properties: {
    add: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: memory.KINDS },
          fact: { type: 'string' },
          kid_age: { type: ['integer', 'null'] },
        },
        required: ['kind', 'fact', 'kid_age'],
        additionalProperties: false,
      },
    },
    remove: { type: 'array', items: { type: 'integer' } },
    why: { type: 'string', description: 'One sentence on what changed and why.' },
  },
  required: ['add', 'remove', 'why'],
  additionalProperties: false,
};

function transcript(rows) {
  return rows.map((m) => `[${m.created_at.slice(0, 10)}] ${m.direction === 'in' ? 'Them' : 'Exit 163'}: ${m.body}`).join('\n');
}

/** Review one texter. Returns { phone, add, remove, why } (applied unless dryRun). */
async function reviewOne(user, { dryRun = false } = {}) {
  const phone = user.phone;
  const since = user.memory_reviewed_at || '1970-01-01';
  const fresh = await q(db().from('sms_messages').select('direction,body,created_at').eq('phone', phone)
    .gt('created_at', since).order('created_at', { ascending: false }).limit(60));
  const hasNewInbound = fresh.some((m) => m.direction === 'in');
  if (!hasNewInbound && !user.notes) {
    if (!dryRun) await q(db().from('sms_users').update({ memory_reviewed_at: new Date().toISOString() }).eq('phone', phone));
    return { phone, skipped: 'no new messages' };
  }

  const facts = await memory.loadFacts(phone);
  const input = [
    `Today is ${todayNJ()}.`,
    `First name: ${user.first_name || 'unknown'}. Home town: ${memory.townName(user.town_slug) || 'unknown'}.`,
    facts.length ? memory.describeFacts(facts) : 'Nothing remembered yet.',
    user.notes ? `Older free-text notes: ${user.notes}` : '',
    `Messages since the last review (oldest first):\n${transcript(fresh.reverse()) || '(none)'}`,
  ].filter(Boolean).join('\n\n');

  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: input }],
  });
  if (res.stop_reason === 'refusal') return { phone, skipped: 'refused' };
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  const ownIds = new Set(facts.map((f) => f.id));
  out.remove = (out.remove || []).filter((id) => ownIds.has(id));

  if (!dryRun) {
    if (out.remove.length) await memory.forget(phone, out.remove);
    const items = (out.add || []).map((a) => ({ kind: a.kind, fact: a.fact, ...(a.kid_age != null ? { kid_age: a.kid_age } : {}) }));
    const result = items.length ? await memory.remember(phone, items, 'review') : { saved: [] };
    out.saved = result.saved;
    await q(db().from('sms_users').update({ memory_reviewed_at: new Date().toISOString(), ...(user.notes ? { notes: null } : {}) }).eq('phone', phone));
  }
  return { phone, ...out };
}

/**
 * Review everyone who texted since their last review (or still has old notes).
 * @param {{limit?:number, dryRun?:boolean, phones?:string[]}} opts
 */
async function reviewAll({ limit = 20, dryRun = false, phones } = {}) {
  let users = await q(db().from('sms_users')
    .select('phone,first_name,town_slug,notes,last_seen_at,memory_reviewed_at').eq('opted_out', false));
  users = users.filter((u) => (phones ? phones.includes(u.phone) : (u.notes || !u.memory_reviewed_at || u.last_seen_at > u.memory_reviewed_at)));
  users = users.slice(0, limit);
  const results = [];
  for (let i = 0; i < users.length; i += 4) {
    const batch = await Promise.all(users.slice(i, i + 4).map((u) => reviewOne(u, { dryRun })
      .catch((e) => ({ phone: u.phone, error: e.message }))));
    results.push(...batch);
  }
  return results;
}

module.exports = { reviewOne, reviewAll };
