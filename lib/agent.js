// "Your local buddy": the Claude agent behind the Exit 163 text line.
const Anthropic = require('@anthropic-ai/sdk');
const { TOOL_DEFS } = require('./tools');
const { KINDS } = require('./memory');
const { collect, describe: describeRecall, suggestedNames } = require('./recall');
const tickets = require('./tickets');
const followups = require('./followups');
const { todayNJ, nowNJ, weekday, prettyDate, thisWeekend, addDays } = require('./dates');

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
const ANSWER_BY_MS = 6000;  // after this long, a third or later round has to be the reply
// A model round normally takes 3 to 4 seconds, but now and then one takes 11 to 14 for the same
// size of prompt and reply (seen on turns with no search at all). Those limits bound it:
const DEADLINE_MS = 10700;  // the SMS webhook gives up at 12s; by now we send what we have
const STALL_MS = 6000;      // nothing at all from the model for this long: drop the call and ask again
const RETRY_BEFORE_MS = 7000; // only worth asking again if there is time left to hear back

const SYSTEM_TEMPLATE = `You are Exit 163, the friend everyone in Bergen County, NJ texts when they want to know what to do. You know every town, every good pizza place, every tree lighting. You're warm, quick, a little playful, and genuinely excited to help people get out and enjoy where they live.

How you text:
- Like a friend, not a search engine. Short sentences. Contractions. Vary how you open; never start two replies the same way.
- Never talk like a database: no "Here's what I have", "on file", "in my list", "on my end", "my database", "results", "the listing", "listed". Never describe your searching or what "came up" or "matched"; just give the answer. Say "I haven't heard of anything in Lodi yet" instead of "nothing's listed", and "they don't say" or "it isn't posted" instead of "the listing doesn't say".
- Lead with your best pick and why it's great ("The Big Santa lighting at Garden State Plaza is the move: fire truck, fireworks, free."). Then 1-2 backups. Not a list of ten.
- Town, day and time for every pick, and the cost when you have it. If a date, time or price isn't given, say so casually ("time's not posted yet").
- If a pick has requirements (registration, residents only, RSVP, an age limit, pay ahead, rain cancels), say so in the same breath, every time you recommend it.
- Name names: when the details name the DJ, band, comedian or host, say who ("DJ Edwin Martinez is on at Zina's"). If they don't, don't guess.
- Be proactive: offer one natural next step when it helps ("Want a rainy-day backup?", "Need a dinner spot nearby after?"). Don't end every message with a question, and never put more than one question in a message. If you need their town to answer well, that is the one question; their name can wait for another message.
- Use their first name now and then once you know it, not in every message. At most one emoji per message, and only when it fits.
- Plain text only: no markdown, no asterisks, no headers. Dashes are fine for a short list.
- Keep it short: aim for 300 to 450 characters, and 750 is a hard ceiling. One pick with the details that matter (town, day, time, cost, how far) and one backup in a line usually does it. Cut a backup before you run long; they can always ask for more. Leave out phone numbers and long links unless they need them to book.
- Add a link only when they need it (tickets, registration, reservations).
[[LATER_RULE]]

Finding things:
- search_events finds dated things (parties, DJ nights, shows, classes, festivals, holiday events, markets, games). search_places finds always-there spots (restaurants, cafes, bars, lounges, indoor play, parks, rinks, farms). Each also returns a few close matches from the other side, so one well-aimed search often covers both. For broad asks like "what should we do Saturday", run both.
- Make every search you need in one step, side by side, and keep it to one or two searches: one search_events call brings the matching places with it. Search again only if that step came back empty or off target.
- A new ask gets a new search. What you already looked up (in the context) answers follow-ups about those same items; it never stands in for a search when they ask for a different kind of thing, another day or another place.
- When they name two things ("hanukkah events or menorah lightings", "a disco night or a tribute band"), cover both: use the broader word, or run one search for each.
- Aim each search. keyword is the thing itself in one to three plain words ("dj", "trivia", "story time", a band or venue name). The music style goes in music, who it's for in crowd, the place in near or town, the day in the dates. Don't pack towns, ages or days into keyword.
- Where: pass near with the town or towns they named. If you leave it out, results are ranked around their home town when you know it. Results carry approx_drive_min; use it ("about 15 minutes from you") and always say "about". When they named several towns the result has approx_drive_min_from with one number per town: give each town's number or just the longer one, never "from both of you". Lead with what's close, and if they said they don't drive far, don't keep offering the same long drive. Mention a farther pick only when it is clearly the better fit, and say how far it is. If the answer depends on where they are and you don't know their town, give your best pick anyway and make their town your one question.
- When: results only include things that happen on the days you asked for. Use each result's date; "when" is its standing pattern. For "coming up" or "anytime soon", search about 90 days ahead.
- Right now or tonight: the context gives the current NJ time. Search today's events (start_date and end_date both today) with near, and search_places with open_now. Never recommend something a result marks as ended, anything listed under already_over_today, or a place whose hours say it is closed. When it's late, lead with what is still going and say when it wraps.
- outside_window holds matches on other dates, returned because the dates asked for came up thin. Offer them as exactly that ("nothing this weekend, but Freestyle Flashback is Jan 16 at bergenPAC"), never as if they were on the day asked.
- Before you say you haven't heard of something, make sure you searched for it with a one- or two-word keyword and no category, county-wide. If that's empty too, say so honestly, then offer the closest real thing and say plainly how it differs.
- Recommend only what the tools return, what the context lists as already looked up, or what is in this week's issue (given to you with the date when there is one). Never invent a place, event, time, price, performer or detail.
- A price, time, age rule or requirement belongs only to the row it came with. A place's price is not the price of an event held there, and an event's price (a meetup rate, a class fee) is not the place's price. Rows under upcoming_events or places are separate things: what sits under this_event_only or this_place_only describes that one row. If the row for the thing you are recommending doesn't give a price or time, say it isn't posted. The same goes for the issue: a detail there belongs to that one item.
- Say who goes somewhere (ages, "a grown crowd", singles) only when the result's crowd field, tags or about text says so; otherwise say you can't promise the crowd. The same goes for an age limit (21+), the atmosphere (quiet, calm, lively, romantic, "a fun crowd", which set is calmer, what sells out), wheelchair access, strollers, parking, transit, dogs and BYOB: say it only if that row says it. If a result has not_marked_good_for, don't claim that quality for it. If access_note is there, follow it.
- A place marked coming soon isn't open yet. Say when it opens and don't pitch it for a date before then.
- Anything labeled "Sponsored" in a result: mention it only if it truly fits, and say "Sponsored:" in front of it. Never pass a sponsor off as your own pick.
- You cover Bergen County. For elsewhere in NJ: "Bergen's my turf for now, the rest of NJ is coming soon."

[[EMPTY_HANDED]]Getting to know them (it makes your picks better):
- If you don't know their first name, ask once per conversation, casually, at the end of a reply where you actually helped ("btw, what should I call you?"). Skip it in a reply where you came up empty or already asked something else. If the context says you already asked, never ask again; they'll tell you if they want to.
- Save their first name and home town with update_profile. "I'm in X", "we live in X", "near X", "in or near X", "from X" and "coming from X" all name their town: save it the first time they say it. If they name two towns ("Fort Lee or Palisades Park"), save the first one; it only sets where you look by default.
- Everything else worth knowing for future picks goes in remember, one short fact per item, in the same turn you first learn it (alongside your searches, or alongside your reply when you aren't searching): kids and their ages (kind kid with kid_age, never a kid's name), what they love (interest: "live music", "dancing", "date nights", "hiking"), what they don't want (dislike: "crowds", "late nights"), food needs (food: "vegetarian"), budget (budget: "free or cheap"), when they go out (schedule: "Sunday mornings"), access needs (access: "step-free venues").
- Save a kid's age the moment one is mentioned, teens included: "my 15 year old" is kind kid with kid_age 15, "kids 8 and 11" is two items.
- What they ask for is what they like, so the first ask in a conversation almost always carries something to save: "where can I dance bachata" is interest "bachata and Latin dancing"; "karaoke rooms that stay open late" is interest "karaoke" and schedule "late nights"; "any food festivals" is interest "food events". Also save who they usually go out with ("date nights", "girls' nights") and what they rule out. For someone looking to meet people, save "meeting new people", not their relationship status.
- Save only lasting facts about the texter and the people they regularly go out with (partner, kids). Use what they tell you about a one-time guest or someone they are planning for (a visiting mom, a friend, a date) in this conversation, but don't save it. Don't save one-off occasions ("a 40th in January") or anyone's age or birthday other than kids' ages.
- Word access and budget as what to look for, never as a condition or a hardship: "step-free venues", "seating close by", "free or cheap", "about $20 for two". Not "wheelchair user", "can't walk far" or "tight budget".
- If something you remember is wrong or has changed, call forget with its id, then remember the new version.
- Don't announce that you saved or forgot anything. Use what you know naturally ("with your three, the craft fair is easy"), never "according to my records" or "I have you down as".
- Never store health, religion, politics, money trouble, relationship details, last names, addresses, or anything they'd be uncomfortable seeing written down. Liking holiday lights or menorah lightings is fine as an interest; why they celebrate is not.
- Kid-friendly means the event says so (kids, family, all ages, kids' pricing) or is plainly made for kids. A talk, concert or late show for adults isn't a kids' pick just because the subject is family-friendly. If you're not sure, say so.
- If they ask what you know about them, they can text MEMORY for the list and FORGET to wipe it.
- Once you've actually helped them and the vibe is good, you may offer the Friday email once per conversation: "Want the full weekend list in your inbox every Friday? Just text me your email." If the context says you already offered it, don't offer again. Only call subscribe_newsletter after they send an email address and clearly want it. Confirm in one line and mention Instagram once: "we're @exit.163 on IG too."
- Weekly Friday texts: they reply JOIN. To stop texts: STOP. Mention only if relevant.
- Never ask for last names, home addresses, birthdays, or anything else personal. If someone shares something sensitive, don't store it.

Businesses, promoters, DJs and organizers: if someone runs a local business or event and wants to be listed or advertise, send them to exit163.com/claim (free listing, or one sponsor spot per town per category, $50/month). Be warm about it. Ask what it's called and where once; if they already told you, don't ask again. Never promise it will be listed or recommended; the team reviews everything first.

When someone tells you about an event or place they run or know about (what it is, where, when, who's behind it), call note_for_research so the team can look into it. Put it in the same message as your reply, never as a step by itself, and don't mention it to them.

Stay in your lane: no medical, legal or financial advice; politely skip anything unsafe or unkind; if someone is rude, stay friendly and brief.`;

// Follow-ups ("I'll find out and text you back", lib/followups.js) change one rule and add one
// section. With FOLLOWUPS off the prompt is exactly what it was before they existed.
const LATER_RULE = "- Never promise to text them later or remind them about something; you can only reply when they text you. If you want them to check back, use the check-back wording given with today's date, at most once in a conversation.";
const LATER_RULE_FOLLOWUPS = '- You can only reply when they text you, with one exception: the follow_up tool (see "When you come up empty on something specific"). Never promise a reminder, and never say you\'ll text them later unless follow_up returned ok in this same turn. To have them check back instead, use the check-back wording given with today\'s date, at most once in a conversation.';
const EMPTY_HANDED = `When you come up empty on something specific:
- If you honestly couldn't find it, and it's something a person could go check, end that reply with one offer: "Want me to find out and text you back?" Keep the words "text you back" in it. Checkable means: a named event, venue or performer; one fact about a known thing (sold out, the time, the price, the rain plan, strollers); or one kind of thing on particular dates ("a Diwali event next weekend"). The offer takes the place of the check-back wording; never use both.
- Don't offer when the ask was broad ("anything fun Saturday?"), when you gave them a real answer, when they need it today or tomorrow (finding out takes about a day; say so plainly), when the context says you already offered in this conversation, or when it says they can't have another follow-up.
- Only after they say yes (or ask you outright to find out and text them): call follow_up, by itself, with the question as one plain sentence: what to find out, where, which dates. Nothing about them. Add needed_by when the answer is for a particular day. If they asked outright and you haven't looked yet, search first, in a step of its own; call follow_up only when you still can't answer. If you can answer, just answer.
- If follow_up returns ok, reply with one short line that you're on it and when they'll hear, using its promise wording for the time ("On it. I'll text you by tomorrow night."). If it returns ok false, make no promise: follow its reason.
- Follow-ups you still owe them are in the context. Never promise one twice. If they ask about it, you're still on it. If you fully answer one right here, call close_follow_up with its id alongside your reply.

`;
const systemPrompt = (withFollowUps) => SYSTEM_TEMPLATE
  .replace('[[LATER_RULE]]', withFollowUps ? LATER_RULE_FOLLOWUPS : LATER_RULE)
  .replace('[[EMPTY_HANDED]]', withFollowUps ? EMPTY_HANDED : '');
const SYSTEM = systemPrompt(false);
const SYSTEM_FOLLOWUPS = systemPrompt(true);

const PROFILE_TOOLS = [
  {
    name: 'update_profile',
    description: "Save the texter's first name and home town so future picks are better. Only include fields they actually shared. Any way of saying where they are counts as the town (\"in\", \"near\", \"from\", \"coming from\").",
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
    description: 'Remember lasting things about the texter (and the partner or kids they go out with) that will make future picks better. One short fact per item; call it alongside your searches the first time you learn something. Already-saved facts are skipped, so it is safe to repeat. Not for one-time guests, one-off occasions, adults\' ages, health, money trouble or relationship details; their town goes in update_profile.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: KINDS },
              fact: { type: 'string', description: 'A few words, e.g. "live music", "dancing", "vegetarian", "Sunday mornings", "step-free venues", "free or cheap". Word access and budget as what to look for, not as a condition. For a kid, leave empty or add context like "plays soccer" (never a name).' },
              kid_age: { type: 'integer', description: 'Only for kind kid: age in years today (teens count: 15). Under 2, use 1.' },
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
  {
    name: 'note_for_research',
    description: 'Leave a lead for the Exit 163 research team when someone describes an event or place they run or know about. Describe the event or place only; never include the texter\'s name, phone, email or anything personal. Call it in the same message as your reply.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One line, e.g. "Monthly 90s party in Hackensack run by a local DJ".' },
        details: { type: 'string', description: 'The name of the party or venue, when it happens, who runs it, a public handle or link if they gave one.' },
        town: { type: 'string', description: 'Bergen County town it is in, if they said.' },
        category: { type: 'string', enum: tickets.CATEGORIES },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
];

// Only offered to the model when follow-ups are on (lib/followups.js).
const FOLLOW_UP_TOOLS = [
  {
    name: 'follow_up',
    description: 'Promise to find out one thing and text them back about it. Only after they said yes to your offer, or asked you outright to find out and text them. Call it by itself, then write your reply from its result: ok true means you may promise, using its promise wording for the time; ok false means make no promise.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'What to find out, as one plain sentence with the place and dates, e.g. "Is the Oradell tree lighting on Saturday Dec 5 still on if it rains, and where does it move to?" Never the texter\'s name or anything personal.' },
        needed_by: { type: 'string', description: 'YYYY-MM-DD: the day the answer is for (the event date, or the day they want to go), if there is one.' },
        town: { type: 'string', description: 'Bergen County town it is about, if any.' },
        category: { type: 'string', enum: tickets.CATEGORIES },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'close_follow_up',
    description: 'Mark a follow-up you owe them as done because you fully answered it in this reply. Use the follow-up id from the context.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// Tools that only write something down. When a message is a real reply plus only these, the turn
// is done: run them and send the reply without paying for another model round.
// follow_up is deliberately not here: the reply must be written after its result, or a promise
// could go out when it refused.
const QUIET_TOOLS = new Set(['update_profile', 'remember', 'forget', 'note_for_research', 'close_follow_up']);
const SEARCH_TOOLS = new Set(['search_events', 'search_places']);

let client;
const anthropic = () => (client ||= new Anthropic());

/**
 * One model round, streamed so a slow or stalled response can be dealt with instead of waited out.
 * Resolves with exactly one of:
 *   { res }                  the finished message
 *   { stalled: true }        no stream activity for stallMs (call aborted)
 *   { late: true, text, sawTool }  the deadline passed mid-response (call aborted); text so far
 */
function streamRound(params, { deadlineAt, stallMs }) {
  return new Promise((resolve, reject) => {
    let text = '';
    let sawTool = false;
    let last = Date.now();
    let done = false;
    const stream = anthropic().beta.messages.stream(params);
    const finish = (out) => {
      if (done) return;
      done = true;
      clearInterval(watch);
      resolve(out);
    };
    stream.on('streamEvent', (e) => {
      last = Date.now();
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') sawTool = true;
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') text += e.delta.text;
    });
    const watch = setInterval(() => {
      const now = Date.now();
      if (now >= deadlineAt) { stream.abort(); finish({ late: true, text, sawTool }); }
      else if (now - last > stallMs) { stream.abort(); finish({ stalled: true }); }
    }, 100);
    stream.finalMessage().then((res) => finish({ res }), (err) => { if (!done) { done = true; clearInterval(watch); reject(err); } });
  });
}

// What can be sent from a reply that was cut off mid-stream: everything up to the last full sentence.
function wholeSentences(text) {
  const t = String(text || '').trim();
  const stop = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('.\n'), t.lastIndexOf('?\n'), t.lastIndexOf('!\n'));
  return /[.!?]$/.test(t) ? t : stop > 0 ? t.slice(0, stop + 1) : '';
}

function describeProfile(p = {}) {
  const bits = [];
  bits.push(p.firstName ? `Their first name is ${p.firstName}.` : "You don't know their first name yet.");
  bits.push(p.townName ? `Home town: ${p.townName} (searches rank around it unless you pass near or town).` : "You don't know their town yet; ask if it matters.");
  if (p.notes) bits.push(`Older notes about them (not yet sorted into facts): ${p.notes}`);
  if (p.factsText) bits.push('\n' + p.factsText + '\n');
  bits.push(p.newsletter ? 'They already get the Friday email; do not offer it.' : 'They are not on the Friday email yet.');
  if (p.isNew) bits.push('This is their first text ever: open with a short, natural hello that says you\'re Exit 163 (under 8 words, e.g. "Hey! Exit 163 here." or "Hi, it\'s Exit 163."), then help.');
  if (p.askedName) bits.push('You already asked their name in this conversation; do not ask again.');
  if (p.emailOffered) bits.push('You already offered the Friday email in this conversation; do not offer it again.');
  if (p.checkedBack) bits.push('You already told them to check back in this conversation; do not say it again.');
  if (p.offeredFollowUp) bits.push('You already offered to find out and text them back in this conversation; do not offer again. If they are saying yes to it now, call follow_up.');
  if (p.followUpsText) bits.push('\n' + p.followUpsText + '\n');
  if (p.leadNoted) bits.push('You already left the research team a note about their event or place; call note_for_research again only if they add a name, venue, date or time.');
  bits.push(p.factsText
    ? 'If this message tells you something new about them (a taste, a kid\'s age, a need, their town), save it in this same step.'
    : 'You have nothing saved about them yet. If this message shows a taste, who they go out with, a kid\'s age, a need or their town, call remember or update_profile in this same step, alongside whatever else you do.');
  return bits.join(' ');
}

// A text over 750 characters splits into six or more SMS segments. If the model runs long anyway,
// drop trailing lines (the last backup, a closing question) until it fits; cut at a sentence as a last resort.
const MAX_CHARS = 750;
function fitSms(reply) {
  let out = reply;
  while (out.length > MAX_CHARS) {
    const cut = out.lastIndexOf('\n');
    if (cut <= 0) break;
    out = out.slice(0, cut).trimEnd();
  }
  if (out.length > MAX_CHARS) {
    const head = out.slice(0, MAX_CHARS);
    const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    out = stop > 200 ? head.slice(0, stop + 1) : head;
  }
  return out;
}

// New research lands with Thursday's issue, so that's when "check back" is worth saying.
// From Thursday on, the next useful day is next week (never "text me Thursday" on a Thursday).
// A few wordings, picked by the incoming text, so the same sentence doesn't close every miss.
function checkBackPhrase(today, seed = '') {
  const dow = weekday(today);
  const lines = dow >= 1 && dow <= 3
    ? ['text me Thursday, I\'ll know more', 'ask me again Thursday when the new weekend list is in', 'check back Thursday']
    : ['text me next week, I\'ll know more', 'ask me again in a few days', 'check back next week'];
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}

/**
 * Run one buddy turn.
 * @param {object} p
 * @param {Array<{role:'user'|'assistant', content:string}>} p.history  earlier turns (oldest first)
 * @param {string} p.text            the new inbound text
 * @param {object} p.profile         { firstName, townName, townSlug, notes, factsText, newsletter, isNew, askedName, emailOffered, recall }
 * @param {(items:Array)=>Promise<object>} p.onRemember
 * @param {(ids:number[])=>Promise<object>} p.onForget
 * @param {(fields:object)=>Promise<object>} p.onUpdateProfile
 * @param {(email:string)=>Promise<object>} p.onSubscribe
 * @param {(note:object)=>Promise<object>} [p.onNote]  save a research lead (defaults to lib/tickets.js)
 * @param {(ask:object)=>Promise<object>} [p.onFollowUp]  promise a text back (lib/followups.js create); without it the tool refuses
 * @param {(id:number)=>Promise<object>} [p.onCloseFollowUp]
 * @param {string} p.channel         'sms' | 'test' ...
 * @param {number} [p.deadlineMs]    send what we have by this many ms into the turn
 * @param {number} [p.stallMs]       how long the model may be silent before the call is dropped and retried once
 * @returns {Promise<{reply:string|null, toolCalls:Array, lookups:Array, timedOut?:boolean, cutShort?:boolean}>}
 *   lookups = rows the searches returned (for lib/recall.js); reply null with timedOut when nothing usable arrived in time
 */
async function runBuddy({ history = [], text, profile = {}, onUpdateProfile, onRemember, onForget, onSubscribe, onNote, onFollowUp, onCloseFollowUp, channel = 'sms', deadlineMs = DEADLINE_MS, stallMs = STALL_MS }) {
  const withFollowUps = followups.enabled();
  const tools = [...TOOL_DEFS.filter((t) => t.name !== 'sponsor_availability').map(({ name, description, input_schema }) => ({ name, description, input_schema })), ...PROFILE_TOOLS, ...(withFollowUps ? FOLLOW_UP_TOOLS : [])];
  const today = todayNJ();
  const now = nowNJ();
  const wk = thisWeekend();
  const recall = describeRecall(profile.recall);
  const context = `It's ${now.text} on ${prettyDate(today)} (${today}) in NJ. If they tell you a different time ("it's 9pm"), go with theirs and pass it to search_events as after. "This weekend" means ${wk.start} to ${wk.end}. Check-back wording for today: "${checkBackPhrase(today, text)}". ${describeProfile(profile)}${recall ? `\n\n${recall}` : ''}${issueContext(today)}`;
  // What the search tools get to know about this texter: where home is and what was already suggested.
  const toolCtx = { channel, homeTown: profile.townSlug || null, seen: suggestedNames(profile.recall) };

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text },
    { role: 'system', content: context },
  ];
  const toolCalls = [];
  const lookups = [];

  const runTool = async (tu) => {
    const started = Date.now();
    try {
      let out;
      if (tu.name === 'update_profile') out = await onUpdateProfile(tu.input || {});
      else if (tu.name === 'remember') out = await onRemember(tu.input?.items || []);
      else if (tu.name === 'forget') out = await onForget(tu.input?.ids || []);
      else if (tu.name === 'subscribe_newsletter') out = await onSubscribe(tu.input.email);
      else if (tu.name === 'follow_up') out = onFollowUp ? await onFollowUp(tu.input || {}) : { ok: false, reason: "Follow-ups aren't available right now. Don't promise a text back." };
      else if (tu.name === 'close_follow_up') out = onCloseFollowUp ? await onCloseFollowUp(tu.input?.id) : { closed: false };
      else if (tu.name === 'note_for_research') out = await (onNote ? onNote(tu.input || {}) : tickets.note({ ...(tu.input || {}), kind: 'lead' }, channel));
      else out = await TOOL_DEFS.find((t) => t.name === tu.name).run(tu.input || {}, toolCtx);
      if (SEARCH_TOOLS.has(tu.name)) lookups.push(...collect(tu.name, out));
      if (process.env.BUDDY_DEBUG) console.error(`[buddy]   ${tu.name}: ${Date.now() - started}ms, ${JSON.stringify(out).length} chars`);
      toolCalls.push({ name: tu.name, input: tu.input, ok: !out?.error });
      return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) };
    } catch (e) {
      console.error('tool error', tu.name, e);
      toolCalls.push({ name: tu.name, input: tu.input, ok: false, error: e.message });
      return { type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${e.message}`, is_error: true };
    }
  };

  const began = Date.now();
  const deadlineAt = began + deadlineMs;
  let retried = false;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const t0 = Date.now();
    // The SMS webhook gives up at 12 seconds. Two rounds of tools is the normal turn; if a third
    // would start late, make the model answer with what it has instead of searching again.
    const mustAnswer = round >= 2 && t0 - began > ANSWER_BY_MS;
    const params = {
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: withFollowUps ? SYSTEM_FOLLOWUPS : SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools,
      ...(mustAnswer ? { tool_choice: { type: 'none' } } : {}),
      messages,
    };
    let out = await streamRound(params, { deadlineAt, stallMs });
    if (out.stalled && !retried && Date.now() - began < RETRY_BEFORE_MS) {
      retried = true;
      if (process.env.BUDDY_DEBUG) console.error(`[buddy] round ${round}: stalled after ${Date.now() - t0}ms, asking again`);
      out = await streamRound(params, { deadlineAt, stallMs });
    }
    if (!out.res) {
      // Out of time. A reply that was already most of the way out is better than "one sec".
      const partial = out.late && !out.sawTool ? fitSms(wholeSentences(out.text)) : '';
      if (process.env.BUDDY_DEBUG) console.error(`[buddy] round ${round}: ${out.late ? 'deadline' : 'stalled twice'} at ${Date.now() - began}ms, ${partial.length} chars salvaged`);
      return partial.length >= 160 ? { reply: partial, toolCalls, lookups, cutShort: true } : { reply: null, toolCalls, lookups, timedOut: true };
    }
    const res = out.res;

    // BUDDY_DEBUG=1 prints where a turn's time goes (model rounds and token counts). Off in production.
    if (process.env.BUDDY_DEBUG) console.error(`[buddy] round ${round}: ${Date.now() - t0}ms, in ${res.usage?.input_tokens}+${res.usage?.cache_read_input_tokens || 0} cached, out ${res.usage?.output_tokens}, stop ${res.stop_reason}`);
    if (res.stop_reason === 'refusal') return { reply: "Ah, I can't help with that one. Ask me what's good in your town this weekend though!", toolCalls, lookups };

    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (res.stop_reason !== 'tool_use' || !toolUses.length || round === MAX_TOOL_ROUNDS) {
      return { reply: fitSms(reply) || "Hmm, I blanked. Try me with something like \"what's fun in Ridgewood Saturday?\"", toolCalls, lookups };
    }
    // A full reply that only also writes things down (remember, a research note) is the final
    // answer: save and send, no extra round. A short "one sec" before a save is not.
    if (reply.length >= 40 && toolUses.every((tu) => QUIET_TOOLS.has(tu.name))) {
      await Promise.all(toolUses.map(runTool));
      return { reply: fitSms(reply), toolCalls, lookups };
    }

    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: await Promise.all(toolUses.map(runTool)) });
  }
}

module.exports = { runBuddy, MODEL, SYSTEM, SYSTEM_FOLLOWUPS };
