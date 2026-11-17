// One personal line per subscriber for the Friday text and email, picked from this
// week's issue using what we remember about them. Empty when nothing truly fits.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_CHARS = 120;
let client;
const anthropic = () => (client ||= new Anthropic());

const SYSTEM = `You write one personal line for an Exit 163 subscriber. Exit 163 is a Bergen County, NJ "what to do this weekend" newsletter and text. You get this week's issue and what we remember about one person. Pick the ONE item from the issue that best fits them and write a single line pointing them to it.

Rules:
- Only items that are in the issue. Use the day, time and town exactly as the issue gives them; leave out anything it doesn't give. Never invent.
- The fit has to be real and specific to what we know: kids' ages, interests, dislikes, budget, schedule, or something in or right next to their home town. If nothing fits better than it would for anyone, return an empty line.
- Kid-friendly means the issue says so (kids, family, all ages, kids' prices) or the item is plainly made for kids. A talk, concert or evening show for adults is not a kids' pick just because its subject is a family movie. Respect dislikes and bedtimes: no 8pm shows for someone with little kids unless the issue says it's for kids.
- Start with their first name and a comma if we know it ("Joe, "). Then a hook that shows why it's for them without repeating personal details back: "for the kids", "for date night", "since you like live music", "right in New Milford". Never mention ages, names of kids, or that we remember things.
- Plain ASCII: no emoji, no curly quotes, no em dashes. Under ${MAX_CHARS} characters. One sentence, friendly, like a text from a local friend.`;

const SCHEMA = {
  type: 'object',
  properties: {
    item: { type: 'string', description: 'Title of the issue item you picked, or empty.' },
    fit: { type: 'string', description: 'Which remembered fact it fits and why, for the editor. Empty if no pick.' },
    line: { type: 'string', description: 'The line to send, or empty if nothing truly fits.' },
  },
  required: ['item', 'fit', 'line'],
  additionalProperties: false,
};

// Texts must stay GSM-7 (plain ASCII) so a curly quote doesn't turn one segment into three.
function toAscii(s) {
  return String(s || '')
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/&/g, 'and').replace(/[<>{}|]/g, '') // also safe inside the email template
    .replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{issueText:string, firstName?:string, townName?:string, summary:string[]}} p
 * @returns {Promise<{line:string, item:string, fit:string}>}
 */
async function personalLine({ issueText, firstName, townName, summary }) {
  if (!summary.length) return { line: '', item: '', fit: 'nothing remembered' };
  const about = [firstName ? `First name: ${firstName}` : 'First name unknown', townName ? `Home town: ${townName}` : null, ...summary.filter((s) => !/^(name|home town):/.test(s))]
    .filter(Boolean).join('\n');
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: `This week's issue:\n${issueText}\n\nWhat we remember about this person:\n${about}` }],
  });
  if (res.stop_reason === 'refusal') return { line: '', item: '', fit: 'refused' };
  const out = JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const line = toAscii(out.line);
  if (line.length > MAX_CHARS + 20) return { line: '', item: out.item, fit: `dropped: too long (${line.length})` };
  return { line, item: out.item, fit: out.fit };
}

module.exports = { personalLine, toAscii, MAX_CHARS };
