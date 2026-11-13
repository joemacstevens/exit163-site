// One inbound text -> one reply. Shared by the Twilio webhook and the test harness.
const { db, q } = require('./db');
const { resolveTown, BY_SLUG } = require('./towns');
const { runBuddy } = require('./agent');
const { addSubscriber, sendWelcome } = require('./newsletter');
const { withTimeout } = require('./http');
const { attachOffer, stripOffer } = require('./deals');

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];
const HELP_WORDS = ['HELP', 'INFO'];
const JOIN_WORDS = ['JOIN', 'BERGEN', 'WEEKEND'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const HELP_TEXT = 'Exit 163: your Bergen County weekend buddy. Text me things like "what\'s on in Ridgewood Saturday?" Reply JOIN for the Friday text (about 1 msg/week). Some replies include a labeled deal. Msg & data rates may apply. Reply STOP to opt out. exit163.com';
const JOIN_TEXT = "You're in! Every Friday morning you'll get the best of the Bergen weekend by text (about 1 msg/week). Msg & data rates may apply. Reply STOP to cancel, HELP for help.";
const DEAL_BUDGET_MS = 1500;   // the Twilio webhook has 15s in all; the agent gets 12
const SLOW_REPLY = "Give me one sec, I'm digging. If I don't text back, try me again or peek at exit163.com.";
const HISTORY_HOURS = 24;

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
  if (['CLAIM', 'SPONSOR', 'ADVERTISE'].includes(word)) {
    return log("Own a place in Bergen? Claim your spot, free: exit163.com/claim");
  }

  const since = new Date(Date.now() - HISTORY_HOURS * 3600e3).toISOString();
  const recent = await q(db().from('sms_messages').select('direction,body').eq('phone', phone)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(15));
  const history = toTurns(recent.reverse().slice(0, -1)); // drop the message just logged

  const profile = {
    firstName: user.first_name,
    townName: user.town_slug ? BY_SLUG.get(user.town_slug)?.name : null,
    notes: user.notes,
    newsletter: Boolean(user.newsletter_opt_in_at),
    isNew: !existing,
    askedName: history.some((t) => t.role === 'assistant' && /call you/i.test(t.content)),
  };

  const result = await withTimeout(runBuddy({
    history, text, profile, channel,
    onUpdateProfile: async (fields) => {
      const patch = {};
      const saved = {};
      if (fields.first_name) patch.first_name = saved.first_name = String(fields.first_name).trim().split(/\s+/)[0].slice(0, 40);
      if (fields.notes) patch.notes = saved.notes = String(fields.notes).slice(0, 500);
      if (fields.town) {
        const slug = resolveTown(fields.town);
        if (slug) { patch.town_slug = slug; saved.town = BY_SLUG.get(slug).name; }
        else saved.town_error = `${fields.town} isn't a Bergen County town I know.`;
      }
      if (Object.keys(patch).length) await q(db().from('sms_users').update(patch).eq('phone', phone));
      return { saved };
    },
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
  }), timeoutMs, { reply: SLOW_REPLY, toolCalls: [], timedOut: true });

  // A deal can ride along on a place the agent already picked. It is added here, after the pick.
  const reply = result.timedOut ? result.reply
    : await withTimeout(attachOffer({ reply: result.reply, seen: result.seen, phone, channel }), DEAL_BUDGET_MS, result.reply);
  return log(reply, { toolCalls: result.toolCalls, timedOut: result.timedOut });
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

module.exports = { handleInbound };
