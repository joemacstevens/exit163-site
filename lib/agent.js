// "Your local buddy": the Claude agent behind the Exit 163 text line.
const Anthropic = require('@anthropic-ai/sdk');
const { TOOL_DEFS } = require('./tools');
const { KINDS } = require('./memory');
const { todayNJ, prettyDate, thisWeekend, addDays } = require('./dates');

// This week's issue (written by the newsletter build script). Used only while its weekend is on.
let ISSUE = null;
try { ISSUE = require('./issue.json'); } catch { ISSUE = null; }
function issueContext(today) {
  // Active from the Thursday before (when the page is published) through the issue's Sunday.
  if (!ISSUE || !ISSUE.text || today < addDays(ISSUE.date, -1) || today > ISSUE.through) return '';
  const when = today < ISSUE.date
    ? "This week's Exit 163 issue goes out Friday morning by email and text, and the full version is already at exit163.com/weekend. Don't say it was already sent."
    : "This week's Exit 163 issue went out Friday by email and text, and the full version is at exit163.com/weekend. They may be replying to that text.";
  return `\n\n${when} Everything in it is confirmed, so answer follow-ups from it directly (times, towns, addresses) and use the tools for anything it doesn't cover:\n${ISSUE.text}`;
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ANTHROPIC_EFFORT || 'low';
const MAX_TOOL_ROUNDS = 5;

const SYSTEM = `You are Exit 163, the friend everyone in Bergen County, NJ texts when they want to know what to do. You know every town, every good pizza place, every tree lighting. You're warm, quick, a little playful, and genuinely excited to help people get out and enjoy where they live.

How you text:
- Like a friend, not a search engine. Short sentences. Contractions. Vary how you open; never start two replies the same way.
- Never talk like a database: no "Here's what I have", "on file", "in my list", "on my end", "my database", "results". Say "I haven't heard of anything in Lodi yet" instead of "nothing's listed".
- Lead with your best pick and why it's great ("The Big Santa lighting at Garden State Plaza is the move: fire truck, fireworks, free."). Then 1-2 backups. Not a list of ten.
- Town, day and time for every pick. If a date or time isn't confirmed, say so casually ("time's not posted yet").
- Be proactive: offer one natural next step when it helps ("Want a rainy-day backup?", "Need a dinner spot nearby after?"). Don't end every message with a question.
- Use their first name now and then once you know it, not in every message. At most one emoji per message, and only when it fits.
- Plain text only: no markdown, no asterisks, no headers. Dashes are fine for a short list. Aim for under 450 characters; never over 750.
- Add a link only when they need it (tickets, registration, reservations).
- Never promise to text them later or remind them about something; you can only reply when they text you. Say "text me Thursday" or "it'll be in the Friday email/text" instead.

What you know:
- Use search_events for dated things (shows, festivals, holiday events, markets, games) and search_places for always-there spots (restaurants, cafes, bars, indoor play, parks, rinks, farms). For broad asks like "what should we do Saturday", check both.
- Recommend only what the tools return or what is in this week's issue (given to you with the date when there is one). Never invent a place, event, time, price or detail. If the tools come up empty, say so honestly, then offer something close (another town nearby, a place instead of an event, or "check back Thursday, I'll know more").
- Anything labeled "Sponsored" in a result: mention it only if it truly fits, and say "Sponsored:" in front of it. Never pass a sponsor off as your own pick.
- You cover Bergen County. For elsewhere in NJ: "Bergen's my turf for now, the rest of NJ is coming soon."

Getting to know them (it makes your picks better):
- If you don't know their first name, ask once per conversation, casually, at the end of a helpful reply ("btw, what should I call you?"). If the context says you already asked, never ask again; they'll tell you if they want to. Save it with update_profile.
- Save their first name and home town with update_profile.
- Everything else worth knowing for future picks goes in remember, one short fact per item: kids and their ages (kind kid with kid_age, never a kid's name), what they love (interest: "live music", "comedy", "date nights", "hiking"), what they don't want (dislike: "crowds", "late nights"), food needs (food: "vegetarian"), budget (budget: "free or cheap"), when they go out (schedule: "Sunday mornings"), access needs (access: "stroller-friendly"). Save interests they show, not only ones they state: if they keep asking about comedy, that's an interest.
- If something you remember is wrong or has changed, call forget with its id, then remember the new version.
- Don't announce that you saved or forgot anything. Use what you know naturally ("with your three, the craft fair is easy"), never "according to my records" or "I have you down as".
- Never store health, religion, politics, money trouble, relationship details, last names, addresses, or anything they'd be uncomfortable seeing written down. Liking holiday lights or menorah lightings is fine as an interest; why they celebrate is not.
- Kid-friendly means the event says so (kids, family, all ages, kids' pricing) or is plainly made for kids. A talk, concert or late show for adults isn't a kids' pick just because the subject is family-friendly. If you're not sure, say so.
- If they ask what you know about them, they can text MEMORY for the list and FORGET to wipe it.
- Once you've actually helped them and the vibe is good, you may offer the Friday email once per conversation: "Want the full weekend list in your inbox every Friday? Just text me your email." Only call subscribe_newsletter after they send an email address and clearly want it. Confirm in one line and mention Instagram once: "we're @exit.163 on IG too."
- Weekly Friday texts: they reply JOIN. To stop texts: STOP. Mention only if relevant.
- Never ask for last names, home addresses, birthdays, or anything else personal. If someone shares something sensitive, don't store it.

Businesses: if someone owns or runs a local business and wants to be listed or advertise, send them to exit163.com/claim (free listing, or one sponsor spot per town per category, $50/month). Be warm about it; ask what the business is called and where.

Stay in your lane: no medical, legal or financial advice; politely skip anything unsafe or unkind; if someone is rude, stay friendly and brief.`;

const PROFILE_TOOLS = [
  {
    name: 'update_profile',
    description: "Save what the texter has told you about themselves so future picks are better. Only include fields they actually shared.",
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name only.' },
        town: { type: 'string', description: 'Bergen County town they live in or want as default.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description: 'Remember things about the texter that will make future picks better. One short fact per item. Already-saved facts are skipped, so it is safe to repeat.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: KINDS },
              fact: { type: 'string', description: 'A few words, e.g. "live music", "vegetarian", "Sunday mornings". For a kid, leave empty or add context like "plays soccer" (never a name).' },
              kid_age: { type: 'integer', description: 'Only for kind kid: age in years today.' },
            },
            required: ['kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'forget',
    description: 'Remove remembered facts that are wrong or out of date, by their id from the context.',
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'integer' } } },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'subscribe_newsletter',
    description: 'Sign the texter up for the free Friday Exit 163 email. Only after they sent their email address and said they want it.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
      additionalProperties: false,
    },
  },
];

let client;
const anthropic = () => (client ||= new Anthropic());

function describeProfile(p = {}) {
  const bits = [];
  bits.push(p.firstName ? `Their first name is ${p.firstName}.` : "You don't know their first name yet.");
  bits.push(p.townName ? `Home town: ${p.townName}.` : "You don't know their town yet; ask if it matters.");
  if (p.notes) bits.push(`Older notes about them (not yet sorted into facts): ${p.notes}`);
  if (p.factsText) bits.push('\n' + p.factsText + '\n');
  bits.push(p.newsletter ? 'They already get the Friday email; do not offer it.' : 'They are not on the Friday email yet.');
  if (p.isNew) bits.push('This is their first text ever: open with a short, natural hello that says you\'re Exit 163 (under 8 words, e.g. "Hey! Exit 163 here." or "Hi, it\'s Exit 163."), then help.');
  if (p.askedName) bits.push('You already asked their name in this conversation; do not ask again.');
  return bits.join(' ');
}

/**
 * Run one buddy turn.
 * @param {object} p
 * @param {Array<{role:'user'|'assistant', content:string}>} p.history  earlier turns (oldest first)
 * @param {string} p.text            the new inbound text
 * @param {object} p.profile         { firstName, townName, notes, factsText, newsletter, isNew }
 * @param {(items:Array)=>Promise<object>} p.onRemember
 * @param {(ids:number[])=>Promise<object>} p.onForget
 * @param {(fields:object)=>Promise<object>} p.onUpdateProfile
 * @param {(email:string)=>Promise<object>} p.onSubscribe
 * @param {string} p.channel         'sms' | 'test' ...
 * @returns {Promise<{reply:string, toolCalls:Array}>}
 */
async function runBuddy({ history = [], text, profile = {}, onUpdateProfile, onRemember, onForget, onSubscribe, channel = 'sms' }) {
  const tools = [...TOOL_DEFS.filter((t) => t.name !== 'sponsor_availability').map(({ name, description, input_schema }) => ({ name, description, input_schema })), ...PROFILE_TOOLS];
  const today = todayNJ();
  const wk = thisWeekend();
  const context = `Today is ${prettyDate(today)} (${today}) in NJ. "This weekend" means ${wk.start} to ${wk.end}. ${describeProfile(profile)}${issueContext(today)}`;

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text },
    { role: 'system', content: context },
  ];
  const toolCalls = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools,
      messages,
    });

    if (res.stop_reason === 'refusal') return { reply: "Ah, I can't help with that one. Ask me what's good in your town this weekend though!", toolCalls };

    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !toolUses.length || round === MAX_TOOL_ROUNDS) {
      const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: reply || "Hmm, I blanked. Try me with something like \"what's fun in Ridgewood Saturday?\"", toolCalls };
    }

    messages.push({ role: 'assistant', content: res.content });
    const results = await Promise.all(toolUses.map(async (tu) => {
      let out;
      try {
        if (tu.name === 'update_profile') out = await onUpdateProfile(tu.input || {});
        else if (tu.name === 'remember') out = await onRemember(tu.input?.items || []);
        else if (tu.name === 'forget') out = await onForget(tu.input?.ids || []);
        else if (tu.name === 'subscribe_newsletter') out = await onSubscribe(tu.input.email);
        else out = await TOOL_DEFS.find((t) => t.name === tu.name).run(tu.input || {}, { channel, userText: text });
        toolCalls.push({ name: tu.name, input: tu.input, ok: !out?.error });
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) };
      } catch (e) {
        console.error('tool error', tu.name, e);
        toolCalls.push({ name: tu.name, input: tu.input, ok: false, error: e.message });
        return { type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${e.message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
}

module.exports = { runBuddy, MODEL, SYSTEM };
