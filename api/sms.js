// POST /api/sms — Twilio inbound-message webhook for the Exit 163 text line.
// Set it in Twilio: Phone Number -> Messaging -> "A message comes in" -> Webhook, HTTP POST,
// https://www.exit163.com/api/sms
//
// Env: TWILIO_AUTH_TOKEN (signature check), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
const { readBody, withTimeout } = require('../lib/http');
const { validSignature, twiml } = require('../lib/twilio');
const { db, q } = require('../lib/db');
const { resolveTown, BY_SLUG } = require('../lib/towns');
const { runBuddy } = require('../lib/agent');

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];
const HELP_WORDS = ['HELP', 'INFO'];
const JOIN_WORDS = ['JOIN', 'BERGEN', 'WEEKEND', 'SUBSCRIBE'];

const HELP_TEXT = 'Exit 163: your Bergen County weekend buddy. Text me questions like "what\'s on in Ridgewood Saturday?" Reply JOIN for the Friday text (about 1 msg/week). Msg & data rates may apply. Reply STOP to opt out. exit163.com';
const JOIN_TEXT = "You're in! Every Friday morning you'll get the best of the Bergen weekend by text (about 1 msg/week). Msg & data rates may apply. Reply STOP to cancel, HELP for help. What town are you in?";
const FIRST_HELLO = "Hey! I'm Exit 163, your Bergen County weekend buddy. ";
const SLOW_REPLY = "Give me one sec, I'm checking. If I don't text back, try again or see exit163.com for this weekend's list.";
const HISTORY_HOURS = 24;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method not allowed'); }
  const params = await readBody(req);

  if (process.env.SKIP_TWILIO_SIGNATURE !== '1' && !validSignature(req, params)) {
    return res.status(403).send('Invalid signature');
  }

  const phone = String(params.From || '').trim();
  const text = String(params.Body || '').trim().slice(0, 1000);
  if (!phone || !text) return twiml(res);
  const word = text.toUpperCase().replace(/[^A-Z]/g, '');
  const now = new Date().toISOString();

  try {
    const existing = await q(db().from('sms_users').select('*').eq('phone', phone).maybeSingle());
    const user = existing || (await q(db().from('sms_users').insert({ phone }).select().single()));
    await q(db().from('sms_messages').insert({ phone, direction: 'in', body: text }));
    db().from('sms_users').update({ last_seen_at: now }).eq('phone', phone).then(() => {}, () => {});

    // Carrier keywords. Twilio's own opt-out handling sends the STOP/START/HELP confirmations,
    // and blocks anything we'd send to an opted-out number; we just keep our records in sync.
    if (STOP_WORDS.includes(word)) {
      await q(db().from('sms_users').update({ opted_out: true, opted_out_at: now, blast_opt_in: false }).eq('phone', phone));
      return twiml(res);
    }
    if (START_WORDS.includes(word) && user.opted_out) {
      await q(db().from('sms_users').update({ opted_out: false }).eq('phone', phone));
      return twiml(res);
    }
    if (HELP_WORDS.includes(word)) return reply(res, phone, params.OptOutType ? null : HELP_TEXT);
    if (user.opted_out) return twiml(res);

    if (JOIN_WORDS.includes(word)) {
      await q(db().from('sms_users').update({ blast_opt_in: true, opt_in_at: now }).eq('phone', phone));
      return reply(res, phone, user.town_slug ? JOIN_TEXT.replace(' What town are you in?', '') : JOIN_TEXT);
    }
    if (word === 'CLAIM' || word === 'SPONSOR' || word === 'ADVERTISE') {
      return reply(res, phone, 'Own a Bergen business? Claim your free listing or grab your town\'s sponsor spot here: exit163.com/claim');
    }

    // Conversation: last day of messages for context.
    const since = new Date(Date.now() - HISTORY_HOURS * 3600e3).toISOString();
    const recent = await q(db().from('sms_messages').select('direction,body').eq('phone', phone)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(13));
    const history = toTurns(recent.reverse().slice(0, -1)); // drop the message we just logged

    let townSlug = user.town_slug;
    const answer = await withTimeout(runBuddy({
      history,
      text,
      townName: townSlug ? BY_SLUG.get(townSlug)?.name : null,
      channel: 'sms',
      onRememberTown: async (town) => {
        const slug = resolveTown(town);
        if (!slug) return { saved: false, reason: 'Not a Bergen County town I know.' };
        townSlug = slug;
        await q(db().from('sms_users').update({ town_slug: slug }).eq('phone', phone));
        return { saved: true, town: BY_SLUG.get(slug).name };
      },
    }), 12000, SLOW_REPLY);

    return reply(res, phone, (existing ? '' : FIRST_HELLO) + answer);
  } catch (e) {
    console.error('sms error', e);
    return twiml(res, "Sorry, I hit a snag. Try again in a minute, or check exit163.com for this weekend's picks.");
  }
};

async function reply(res, phone, message) {
  if (message) await q(db().from('sms_messages').insert({ phone, direction: 'out', body: message })).catch(() => {});
  return twiml(res, message);
}

// Collapse logged SMS rows into alternating user/assistant turns starting with a user turn.
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
