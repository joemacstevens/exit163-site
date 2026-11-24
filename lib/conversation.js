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
const { attachOffer, stripOffer, forgetPhone } = require('./deals');
const { logConsent } = require('./consent');

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];
const HELP_WORDS = ['HELP', 'INFO'];
const JOIN_WORDS = ['JOIN', 'SUBSCRIBE', 'BERGEN', 'WEEKEND']; // BERGEN and WEEKEND are listed as opt-in keywords in terms.html
const FORGET_WORDS = ['FORGET', 'FORGETME', 'FORGETALL'];
const MEMORY_WORDS = ['MEMORY', 'MYINFO'];
const MEMORY_ASK = /\bwhat (do|did|else do) you (know|remember) about me\b|\bwhat have you saved about me\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const HELP_TEXT = 'Exit 163: your Bergen County weekend buddy. Text me things like "what\'s on in Ridgewood Saturday?" Reply JOIN for the Friday marketing text (about 1 msg/week). Some replies include a labeled deal. Msg & data rates may apply. Reply STOP to opt out. exit163.com';
const JOIN_TEXT = "You're in! Every Friday morning you'll get the best of the Bergen weekend in a marketing text (about 1 msg/week). Msg & data rates may apply. Reply STOP to cancel, HELP for help.";
const DEAL_BUDGET_MS = 1500;   // a deal lookup that takes longer than this is skipped; the reply goes out without one
const SLOW_REPLY = "Give me one sec, I'm digging. If I don't text back, try me again or peek at exit163.com.";
// When the reply can come as a second text (p.late below): we will text back, so say so plainly.
const HOLD_REPLY = "Still digging on that one. I'll text you back in a minute.";
const LATE_FAIL_REPLY = "Sorry, that one took me too long. Try asking me again, or peek at exit163.com for this weekend's picks.";
// How long a turn may run in all once the holding text is out (api/sms.js maxDuration is 60).
const LATE_MS = 45000;
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

// A tapback on one of our texts reaches us as a text of its own: Liked “the whole message”,
// Reacted 😂 to “…”, 👍 to “…”, Removed a heart from “…”, Loved an image. It isn't a question,
// so it gets no answer. The quote has to run to the end of the text, so that
// Loved "A Christmas Story" last night, what else is like it? still reaches the agent.
const OPEN_QUOTE = '[“"„«]';
const REACTION_START = new RegExp(
  '^(?:(?:liked|loved|disliked|laughed at|emphasi[sz]ed|questioned)\\s+' + OPEN_QUOTE
  + '|removed\\s+[^“"„«]{1,40}?\\s+from\\s+' + OPEN_QUOTE
  + '|reacted\\s+\\S{1,16}\\s+to\\s+' + OPEN_QUOTE
  + '|[^\\p{L}\\p{N}\\s“"„«]{1,16}\\s+to\\s+' + OPEN_QUOTE + ')', 'iu');
const REACTION_END = /[”"»]$/;
const REACTION_MEDIA = /^(?:liked|loved|disliked|laughed at|emphasi[sz]ed|questioned|reacted \S{1,16} to|removed \S[^“"„«]{0,40}? from)\s+an?\s+(?:image|photo|video|movie|attachment|audio message)\.?$/i;
const INVISIBLE = /[​-‏‪-‮⁠﻿]/g; // Android wraps the emoji in these
/** @param {string} text  @param {boolean} [cut]  the text was cut to length, so its closing quote may be gone */
function isReaction(text, cut = false) {
  const t = String(text || '').replace(INVISIBLE, '').trim();
  if (REACTION_MEDIA.test(t)) return true;
  return REACTION_START.test(t) && (cut || REACTION_END.test(t));
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
 * @param {number} [p.timeoutMs]  how long the caller can wait for the reply (Twilio's webhook window)
 * @param {object} [p.late]  lets a slow answer go out as a second text instead of being dropped:
 *   { send: (body) => Promise, keepAlive: (promise) => void }. When the agent misses timeoutMs,
 *   the reply is HOLD_REPLY and the answer is sent through late.send once ready (up to lateMs).
 * @param {number} [p.lateMs]
 * @returns {Promise<{reply: string|null, toolCalls?: Array}>}  reply null = send nothing
 */
async function handleInbound({ phone, text, optOutType, channel = 'sms', dryRunNewsletter = false, timeoutMs = 12000, late = null, lateMs = LATE_MS }) {
  const full = String(text || '').trim();
  text = full.slice(0, 1000);
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
    // Log the opt-out event for TFV compliance
    await logConsent({
      phone,
      method: 'keyword',
      source: word,
      eventType: 'opt_out',
    }).catch((e) => console.error('consent log failed', e.message));
    return { reply: null };
  }
  if (START_WORDS.includes(word) && user.opted_out) {
    await q(db().from('sms_users').update({ opted_out: false }).eq('phone', phone));
    return { reply: null };
  }
  if (HELP_WORDS.includes(word)) return log(optOutType ? null : HELP_TEXT);
  if (user.opted_out) return { reply: null };
  // Logged above (the nightly review can read a "Loved" as a like), but never answered.
  if (isReaction(text, full.length > text.length)) return { reply: null, reaction: true };
  // "weekend?" or "Bergen?" is a question for the chat, not an opt-in. (STOP above stays strict on purpose.)
  if (JOIN_WORDS.includes(word) && !/\?\s*$/.test(text)) {
    await q(db().from('sms_users').update({ blast_opt_in: true, opt_in_at: now }).eq('phone', phone));
    
    // Log keyword consent (initial or double opt-in confirmation)
    // If they already have blast_opt_in, this is a double opt-in confirmation
    const isDoubleOptIn = user.blast_opt_in === true;
    await logConsent({
      phone,
      method: 'keyword',
      source: word,
      eventType: isDoubleOptIn ? 'double_optin_confirm' : 'initial_consent',
    }).catch((e) => console.error('consent log failed', e.message));
    
    return log(JOIN_TEXT + (user.town_slug ? '' : ' What town are you in?'));
  }
  if (FORGET_WORDS.includes(word)) {
    const { email } = await memory.forgetAll(phone);
    if (email) clearPersonalPick(email).catch((e) => console.error('clear personal pick', e.message));
    await forgetPhone(phone).catch((e) => console.error('forget deal codes', e.message));
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
    ...nameAsk(history),
    emailOffered: history.some((t) => t.role === 'assistant' && /inbox every friday|text me your email|friday email/i.test(t.content)),
    checkedBack: history.some((t) => t.role === 'assistant' && /\b(?:text me|ask me again|check back)\b.{0,30}\b(?:thursday|next week|few days)\b/i.test(t.content)),
    leadNoted: Boolean(lead),
    offeredFollowUp: history.some((t) => t.role === 'assistant' && FOLLOW_UP_OFFER.test(t.content)),
    followUpsText: followups.describe(owed),
    // What the tools returned earlier in this conversation (lib/recall.js).
    recall: user.prefs?.recent || null,
  };
  let townSlug = user.town_slug || null; // kept current if they tell us their town mid-turn

  const turn = runBuddy({
    history, text, profile, channel,
    deadlineMs: (late ? lateMs : timeoutMs) - OVERHEAD_MS,
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
      // Only what they said themselves is saved: each item has to quote their own texts (memory.saidIt).
      // Without this, picks we suggested got saved as their tastes when all they sent was a name or an email.
      const theirs = [text, ...history.filter((t) => t.role === 'user').map((t) => t.content)];
      for (const it of Array.isArray(items) ? items : []) {
        if (!it || !memory.saidIt(it.they_said, theirs)) {
          moved.push(`${(it && (it.fact || it.kind)) || 'item'}: not saved. they_said has to be their own words from one of their texts; something you suggested is not something they like until they say so.`);
          continue;
        }
        const notMusic = memory.musicUnsupported(it.kind, it.fact, it.they_said);
        if (notMusic) { moved.push(`${it.fact}: not saved. ${notMusic}`); continue; }
        const m = it.kind !== 'kid' && /^(?:lives?|living|based|home|is|are|we're|i'm)?\s*(?:in|near|from|around|by|close to)\s+(.+)$/i.exec(String(it.fact || '').trim());
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
  });
  turn.catch(() => {}); // a turn that fails after we stopped waiting is handled below, never unhandled
  const MISSED = { reply: null, toolCalls: [], timedOut: true };
  const result = await withTimeout(turn, timeoutMs, MISSED);

  if (result === MISSED && late) {
    // Out of Twilio's window: say we're on it now, and text the answer when it lands.
    late.keepAlive((async () => {
      let reply = LATE_FAIL_REPLY;
      let done = null;
      try {
        done = await turn;
        if (done.reply) reply = await withDeal(done);
      } catch (e) { console.error('late turn failed', e.message); }
      try {
        await late.send(reply);
      } catch (e) { console.error('late send failed', e.message); return; }
      await log(reply);
      if (done && done.reply) await saveAfter(done).catch((e) => console.error('late save', e.message));
    })());
    return log(HOLD_REPLY, { held: true });
  }
  if (!result.reply) result.reply = SLOW_REPLY;
  const reply = result.timedOut ? result.reply : await withDeal(result);
  await saveAfter(result);
  return log(reply, { toolCalls: result.toolCalls, timedOut: result.timedOut, cutShort: result.cutShort });

  // A deal can ride along on a place the agent already picked. It is added here, after the pick;
  // result.reply stays as the agent wrote it (the search digest and miss tickets read that).
  function withDeal(r) {
    return withTimeout(attachOffer({ reply: r.reply, seen: r.seen, phone, channel }), DEAL_BUDGET_MS, r.reply);
  }

  // After a reply is settled: research tickets for misses and the search digest for next time.
  async function saveAfter(result) {
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
  }
}

// The name ask (lib/agent.js describeProfile): never in the first reply, at most once a conversation.
// priorReplies = our replies so far in this conversation; askedName = one of them already asked.
const ASKED_NAME = /call you|your name|who (?:am i|i'm|im) texting/i;
function nameAsk(history = []) {
  const ours = history.filter((t) => t.role === 'assistant');
  return { priorReplies: ours.length, askedName: ours.some((t) => ASKED_NAME.test(t.content)) };
}

// Collapse logged SMS rows into user/assistant turns starting with a user turn.
function toTurns(rows) {
  const turns = [];
  for (const r of rows) {
    const role = r.direction === 'in' ? 'user' : 'assistant';
    const body = role === 'assistant' ? stripOffer(r.body) : r.body;   // the agent never sees deals
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += '\n' + body;
    else turns.push({ role, content: body });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns; // a trailing unanswered user turn is fine: the API merges consecutive user turns
}

module.exports = { handleInbound, townIn, leadFacts, isReaction, nameAsk, ASKED_NAME, SLOW_REPLY, HOLD_REPLY, LATE_FAIL_REPLY };
