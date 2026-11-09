// "Your local buddy": the Claude agent behind the Exit 163 text line.
const Anthropic = require('@anthropic-ai/sdk');
const { TOOL_DEFS } = require('./tools');
const { todayNJ, prettyDate, thisWeekend } = require('./dates');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ANTHROPIC_EFFORT || 'low';
const MAX_TOOL_ROUNDS = 4;

const SYSTEM = `You are Exit 163, a friendly local buddy who texts people about what to do in Bergen County, New Jersey.

How you sound: a neighbor who knows every town. Warm, specific, quick. Town and time every time. Honest when something isn't posted yet.

Hard rules:
- Recommend only things that come back from your tools. Never invent an event, a time, a price or a place. If the tools have nothing, say so and suggest checking back Friday or texting another town.
- If an event's date or time isn't confirmed, say so ("time not posted yet").
- If a tool result includes an item labeled "Sponsored", you may mention it only when it fits what they asked, and you must say "Sponsored:" in front of it. Never present a sponsor as your own pick.
- This is SMS: plain text only, no markdown, no bullet symbols other than a simple dash. Aim for under 400 characters, never more than 700. Give 2-3 picks, not a list of ten.
- Add the source link only when it's useful (tickets, registration). Use exit163.com/holidays for the full holiday list.
- Call remember_town only when they say where they live or ask you to use a town by default ("I'm in Ridgewood", "I live in Teaneck"), not when they just ask about a town. Don't announce that you saved it.
- You cover Bergen County only for now. For elsewhere in NJ, say it's coming soon.
- Don't ask for personal info. Don't give medical, legal or financial advice.
- If someone wants the weekly Friday text, tell them to reply JOIN. To stop texts: reply STOP.`;

// SMS-only tool: save the texter's home town.
const REMEMBER_TOWN = {
  name: 'remember_town',
  description: "Save the texter's home town so future answers default to it.",
  input_schema: {
    type: 'object',
    properties: { town: { type: 'string', description: 'Bergen County town name' } },
    required: ['town'],
    additionalProperties: false,
  },
};

let client;
const anthropic = () => (client ||= new Anthropic());

/**
 * Run one buddy turn.
 * @param {object} p
 * @param {Array<{role:'user'|'assistant', content:string}>} p.history  earlier turns (oldest first)
 * @param {string} p.text        the new inbound text
 * @param {string|null} p.townName  saved home town, if any
 * @param {(town:string)=>Promise<object>} p.onRememberTown
 * @param {string} p.channel     'sms' | 'web' ...
 */
async function runBuddy({ history = [], text, townName, onRememberTown, channel = 'sms' }) {
  const tools = [...TOOL_DEFS.map(({ name, description, input_schema }) => ({ name, description, input_schema })), REMEMBER_TOWN];
  const today = todayNJ();
  const wk = thisWeekend();
  const context = `Today is ${prettyDate(today)} (${today}) in NJ. "This weekend" means ${wk.start} to ${wk.end}. ` +
    (townName ? `The texter's saved home town is ${townName}.` : 'You do not know their town yet; ask if it matters.');

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text },
    { role: 'system', content: context },
  ];

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

    if (res.stop_reason === 'refusal') return "Sorry, I can't help with that one. Ask me what's happening in your town this weekend!";

    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !toolUses.length || round === MAX_TOOL_ROUNDS) {
      const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return reply || "I'm drawing a blank. Try: \"what's happening in Ridgewood this weekend?\"";
    }

    messages.push({ role: 'assistant', content: res.content });
    const results = await Promise.all(toolUses.map(async (tu) => {
      try {
        const out = tu.name === 'remember_town'
          ? await onRememberTown(tu.input.town)
          : await TOOL_DEFS.find((t) => t.name === tu.name).run(tu.input || {}, { channel, userText: text });
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) };
      } catch (e) {
        console.error('tool error', tu.name, e);
        return { type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${e.message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
}

module.exports = { runBuddy, MODEL };
