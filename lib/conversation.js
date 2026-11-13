// One inbound text -> one reply. Shared by the Twilio webhook and the test harness.
const { db, q } = require('./db');
const { resolveTown, BY_SLUG } = require('./towns');
const { runBuddy } = require('./agent');
const { addSubscriber, sendWelcome, clearPersonalPick } = require('./newsletter');
const memory = require('./memory');
const recall = require('./recall');
const tickets = require('./tickets');
const followups = require('./followups');
const { withTimeout } = require('./http');

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];
const HELP_WORDS = ['HELP', 'INFO'];
const JOIN_WORDS = ['JOIN', 'BERGEN', 'WEEKEND'];
const FORGET_WORDS = ['FORGET', 'FORGETME', 'FORGETALL'];
const MEMORY_WORDS = ['MEMORY', 'MYINFO'];
const MEMORY_ASK = /\bwhat (do|did|else do) you (know|remember) about me\b|\bwhat have you saved about me\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const HELP_TEXT = 'Exit 163: your Bergen County weekend buddy. Text me things like "what\'s on in Ridgewood Saturday?" Reply JOIN for the Friday text (about 1 msg/week). Msg & data rates may apply. Reply STOP to opt out. exit163.com';
const JOIN_TEXT = "You're in! Every Friday morning you'll get the best of the Bergen weekend by text (about 1 msg/week). Msg & data rates may apply. Reply STOP to cancel, HELP for help.";
const SLOW_REPLY = "Give me one sec, I'm digging. If I don't text back, try me again or peek at exit163.com.";
const HISTORY_HOURS = 24;
// Leave this much of the timeout for our own reads and writes around the model (lib/agent.js DEADLINE_MS).
const OVERHEAD_MS = 1300;

// "near englewood", "we live in garfield", "coming from fair lawn and paramus": the first Bergen
// town named that way, or null. A bare "in X" doesn't count ("a christmas event in bergenfield"
// says where the event is, not where they are).
const TOWN_CUE = /\b(?:near|around|from|close to|outside of|live in|lives in|living in|based in|moved to|we'?re in|we are in|i'?m in|i am in)\s+((?:[a-z.'-]+\s*){1,3})/gi;
function townIn(text) {
  for (const m of String(text).matchAll(TOWN_CUE)) {
    const parts = m[1].trim().split(/\s+/);
    for (let n = Math.min(3, parts.length); n >= 1; n--) {
      const slug = resolveTown(parts.slice(0, n).join(' '));
      if (slug && slug !== 'bergen-county') return slug;
    }
  }
  return null;
}

// Words in a lead that look like new facts: names (capitalized mid-sentence), handles, anything with a digit.
function leadFacts(text) {
  const out = new Set();
  for (const sentence of String(text || '').split(/(?<=[.!?;])\s+/)) {
    sentence.trim().split(/\s+/).forEach((w, i) => {
      const bare = w.replace(/^[^\w@]+|[^\w]+$/g, '');
      if (bare.length > 1 && (/\d/.test(bare) || bare.startsWith('@') || (i > 0 && /^[A-Z]/.test(bare)))) out.add(bare.toLowerCase());
    });
  }
  return [...out];
}
// How the agent words an honest miss (see "Say 'I haven't heard of anything'" in lib/agent.js).
// The buddy's offer to find out and text back (wording fixed in lib/agent.js), and a texter asking
// for that outright. One of the two has to be there before a follow-up can be created: the yes is
// the consent for the later text, so it is checked here and not left to the model.
const FOLLOW_UP_OFFER = /\btext you back\b/i;
const FOLLOW_UP_ASK = /\b(?:text|message|let|tell|ping|hit)\s+me\b|\bget back to me\b|\bfind out\b|\blook into\b/i;
const MISS_REPLY = /\b(?:haven'?t (?:heard|found|come across|seen)|don'?t know of|do not know of|can'?t find|couldn'?t find|not aware of|nothing (?:solid|yet)|no luck)\b/i;

/**
 * @param {object} p
 * @param {string} p.phone   E.164 sender
 * @param {string} p.text
 * @param {string} [p.optOutType]  Twilio's OptOutType param, if any
 * @param {string} [p.channel]     'sms' | 'test'
 * @param {boolean} [p.dryRunNewsletter]  don't actually subscribe (tests)
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{reply: string|null, toolCalls?: Array}>}  reply null = send nothing
 */
async function handleInbound({ phone, text, optOutType, channel = 'sms', dryRunNewsletter = false, timeoutMs = 12000 }) {
  text = String(text || '').trim().slice(0, 1000);
  if (!phone || !text) return { reply: null };
  const word = text.toUpperCase().replace(/[^A-Z]/g, '');
  const now = new Date().toISOString();

  const existing = await q(db().from('sms_users').select('*').eq('phone', phone).maybeSingle());
  const user = existing || (await q(db().from('sms_users').insert({ phone }).select().single()));
  await q(db().from('sms_messages').insert({ phone, direction: 'in', body: text }));
  db().from('sms_users').update({ last_seen_at: now }).eq('phone', phone).then(() => {}, () => {});

  const log = async (reply, extra = {}) => {
    if (reply) await q(db().from('sms_messages').insert({ phone, direction: 'out', body: reply })).catch(() => {});
    return { reply, ...extra };
  };

  // Carrier keywords. Twilio's opt-out handling sends the STOP/START confirmations and blocks
  // anything we'd send to an opted-out number; we keep our records in sync.
  if (STOP_WORDS.includes(word)) {
    await q(db().from('sms_users').update({ opted_out: true, opted_out_at: now, blast_opt_in: false }).eq('phone', phone));
    await followups.cancelOpen(phone);
    return { reply: null };
  }
  if (START_WORDS.includes(word) && user.opted_out) {
    await q(db().from('sms_users').update({ opted_out: false }).eq('phone', phone));
    return { reply: null };
  }
  if (HELP_WORDS.includes(word)) return log(optOutType ? null : HELP_TEXT);
  if (user.opted_out) return { reply: null };
  if (JOIN_WORDS.includes(word)) {
    await q(db().from('sms_users').update({ blast_opt_in: true, opt_in_at: now }).eq('phone', phone));
    return log(JOIN_TEXT + (user.town_slug ? '' : ' What town are you in?'));
  }
  if (FORGET_WORDS.includes(word)) {
    const { email } = await memory.forgetAll(phone);
    if (email) clearPersonalPick(email).catch((e) => console.error('clear personal pick', e.message));
    const still = [user.blast_opt_in && 'the Friday text', email && 'the Friday email'].filter(Boolean).join(' and ');
    return log(`Done. I've wiped what I knew about you: name, town, what you like, and our chat history.${still ? ` You'll still get ${still}; reply STOP to end texts.` : ''}`);
  }
  if (MEMORY_WORDS.includes(word) || MEMORY_ASK.test(text)) {
    const facts = await memory.loadFacts(phone);
    const bits = memory.summarize({ firstName: user.first_name, townName: memory.townName(user.town_slug), facts });
    if (user.notes) bits.push(`notes: ${user.notes}`);
    return log(bits.length
      ? `Here's what I remember: ${bits.join('; ')}. I use it to pick things you'll like. Tell me if anything's off, or text FORGET to wipe it all.`
      : "Nothing yet! Tell me your town, who you go out with (kids? ages?) and what you're into, and my picks get a lot better.");
  }
  if (['CLAIM', 'SPONSOR', 'ADVERTISE'].includes(word)) {
    return log("Own a place in Bergen? Claim your spot, free: exit163.com/claim");
  }

  const since = new Date(Date.now() - HISTORY_HOURS * 3600e3).toISOString();
  const recent = await q(db().from('sms_messages').select('direction,body').eq('phone', phone)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(15));
  const history = toTurns(recent.reverse().slice(0, -1)); // drop the message just logged

  // Their town, straight from how they said it, so it is known this turn and never depends on the model.
  if (!user.town_slug) {
    const slug = townIn(text);
    if (slug) {
      user.town_slug = slug;
      await q(db().from('sms_users').update({ town_slug: slug }).eq('phone', phone)).catch((e) => console.error('town save', e.message));
    }
  }

  const [facts, owed] = await Promise.all([memory.loadFacts(phone), followups.forContext(phone)]);
  const lastSaid = [...history].reverse().find((t) => t.role === 'assistant')?.content || '';
  const prior = recall.fresh(user.prefs?.recent) ? user.prefs.recent : null;
  let lead = prior?.lead || null; // what this conversation already told research (see onNote)
  const profile = {
    factsText: memory.describeFacts(facts),
    firstName: user.first_name,
    townName: user.town_slug ? BY_SLUG.get(user.town_slug)?.name : null,
    townSlug: user.town_slug || null,
    notes: user.notes,
    newsletter: Boolean(user.newsletter_opt_in_at),
    isNew: !existing,
    askedName: history.some((t) => t.role === 'assistant' && /call you/i.test(t.content)),
    emailOffered: history.some((t) => t.role === 'assistant' && /inbox every friday|text me your email|friday email/i.test(t.content)),
    checkedBack: history.some((t) => t.role === 'assistant' && /\b(?:text me|ask me again|check back)\b.{0,30}\b(?:thursday|next week|few days)\b/i.test(t.content)),
    leadNoted: Boolean(lead),
    offeredFollowUp: history.some((t) => t.role === 'assistant' && FOLLOW_UP_OFFER.test(t.content)),
    followUpsText: followups.describe(owed),
    // What the tools returned earlier in this conversation (lib/recall.js).
    recall: user.prefs?.recent || null,
  };
  let townSlug = user.town_slug || null; // kept current if they tell us their town mid-turn

  const result = await withTimeout(runBuddy({
    history, text, profile, channel,
    deadlineMs: timeoutMs - OVERHEAD_MS,
    // One note per lead per conversation. A second one goes through only if it adds facts
    // (a name, a venue, a date), so "can you tell people about it?" doesn't file it again.
    onNote: async (input) => {
      const said = leadFacts(`${input.summary || ''}. ${input.details || ''}`);
      if (lead && said.filter((w) => !lead.seen.includes(w)).length < 2) return { noted: true, already_noted: 'Nothing new since the note you already left; no need to call this again unless they add a name, venue or date.' };
      await tickets.note({ ...input, kind: 'lead' }, channel);
      lead = { at: now, seen: [...new Set([...(lead?.seen || []), ...said])].slice(0, 80) };
      return { noted: true };
    },
    onFollowUp: async (input) => {
      if (!FOLLOW_UP_OFFER.test(lastSaid) && !FOLLOW_UP_ASK.test(text)) {
        return { ok: false, reason: 'They have not agreed to a text back yet. Offer first ("Want me to find out and text you back?") and call this only after they say yes. Make no promise in this reply.' };
      }
      return followups.create({ ...input, phone, channel });
    },
    onCloseFollowUp: (id) => followups.close(phone, id),
    onUpdateProfile: async (fields) => {
      const patch = {};
      const saved = {};
      if (fields.first_name) patch.first_name = saved.first_name = String(fields.first_name).trim().split(/\s+/)[0].slice(0, 40);
      if (fields.town) {
        const slug = resolveTown(fields.town);
        if (slug) { patch.town_slug = townSlug = slug; saved.town = BY_SLUG.get(slug).name; }
        else saved.town_error = `${fields.town} isn't a Bergen County town I know.`;
      }
      if (Object.keys(patch).length) await q(db().from('sms_users').update(patch).eq('phone', phone));
      return { saved };
    },
    onRemember: async (items) => {
      // "near River Edge" saved as a fact is really their town: put it where searches can use it.
      const rest = [];
      const moved = [];
      for (const it of Array.isArray(items) ? items : []) {
        const m = it && it.kind !== 'kid' && /^(?:lives?|living|based|home|is|are|we're|i'm)?\s*(?:in|near|from|around|by|close to)\s+(.+)$/i.exec(String(it.fact || '').trim());
        const slug = m ? resolveTown(m[1]) : null;
        if (slug && slug !== 'bergen-county') {
          if (!townSlug) { townSlug = slug; await q(db().from('sms_users').update({ town_slug: slug }).eq('phone', phone)); }
          moved.push(`${BY_SLUG.get(slug).name} is saved as their town, not as a fact`);
        } else rest.push(it);
      }
      const out = await memory.remember(phone, rest, 'chat');
      return moved.length ? { ...out, skipped: [...(out.skipped || []), ...moved] } : out;
    },
    onForget: (ids) => memory.forget(phone, ids),
    onSubscribe: async (email) => {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { error: 'That email looks off. Ask them to double-check it.' };
      if (!dryRunNewsletter) {
        const { isNew } = await addSubscriber(email);
        if (isNew) await sendWelcome(email).catch((e) => console.error('welcome email failed', e));
      }
      await q(db().from('sms_users').update({ email, newsletter_opt_in_at: now }).eq('phone', phone));
      return { subscribed: true, email, note: 'Welcome email sent. Mention @exit.163 on Instagram once.' };
    },
  }), timeoutMs, { reply: null, toolCalls: [], timedOut: true });
  if (!result.reply) result.reply = SLOW_REPLY;

  // We told them we had nothing: leave a ticket so research can go find it. Like the queries
  // table, it records the ask and the searches tried, never who asked.
  if (result.reply && !result.timedOut && MISS_REPLY.test(result.reply)) {
    const searches = (result.toolCalls || []).filter((c) => /^search_/.test(c.name));
    const first = searches.map((c) => c.input || {}).find((i) => i.town || i.near) || {};
    tickets.note({
      kind: 'gap',
      summary: text,
      details: `Tried: ${searches.map((c) => `${c.name.replace('search_', '')} ${JSON.stringify(c.input)}`).join('; ') || 'no search'}`,
      town: first.town || String(first.near || '').split(',')[0] || (townSlug ? BY_SLUG.get(townSlug).name : null),
      category: (searches.map((c) => c.input?.category).find(Boolean)) || null,
    }, channel).catch(() => {});
  }

  // Keep a digest of what the searches returned (and whether a lead was noted) so the next text can build on it.
  if ((result.lookups && result.lookups.length) || lead !== (prior?.lead || null)) {
    const digest = result.lookups && result.lookups.length ? recall.merge(prior, result.lookups, result.reply) : { at: now, items: prior?.items || [] };
    const recent = { ...digest, ...(lead ? { lead } : {}) };
    await q(db().from('sms_users').update({ prefs: { ...(user.prefs || {}), recent } }).eq('phone', phone))
      .catch((e) => console.error('recall save', e.message));
  }

  return log(result.reply, { toolCalls: result.toolCalls, timedOut: result.timedOut, cutShort: result.cutShort });
}

// Collapse logged SMS rows into user/assistant turns starting with a user turn.
function toTurns(rows) {
  const turns = [];
  for (const r of rows) {
    const role = r.direction === 'in' ? 'user' : 'assistant';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += '\n' + r.body;
    else turns.push({ role, content: r.body });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns; // a trailing unanswered user turn is fine: the API merges consecutive user turns
}

module.exports = { handleInbound, townIn, leadFacts };
