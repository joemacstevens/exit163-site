const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Agent - Prompt improvements (light smoke check)', () => {
  const agentCode = fs.readFileSync(path.join(__dirname, '../lib/agent.js'), 'utf8');
  
  it('should mention greeting variation', () => {
    assert.ok(agentCode.includes('Vary how you open'), 'Should mention varying greetings');
  });

  it('should scope no-guessing to logistics', () => {
    const hasLogisticsScope = /unbacked logistics|logistics.*unless.*data/i.test(agentCode);
    assert.ok(hasLogisticsScope, 'Should scope no-guessing rule to logistics');
  });
});

describe('Agent - friend voice', () => {
  const { SYSTEM, SYSTEM_FOLLOWUPS, describeProfile, nameAskBit } = require('../lib/agent.js');

  it('marks the voice examples as style only, made up, never to recommend', () => {
    for (const s of [SYSTEM, SYSTEM_FOLLOWUPS]) {
      assert.match(s, /Your voice\. These are STYLE examples only: the places, dates and prices in them are made up\. Never recommend, quote or reuse anything from them/);
    }
  });

  it('bans announcer openers and lists for one or two picks', () => {
    for (const w of ['"Bad news:"', '"Good news:"', '"Sadly,"', '"Heads up"', '"Great question"', '"Here are a few good ones:"', '"Here\'s what..."']) {
      assert.ok(SYSTEM.includes(w), `should ban ${w}`);
    }
    assert.match(SYSTEM, /One or two picks go in sentences, never a list; a short dashed list only for 3 or more/);
  });

  it('keeps the factual-accuracy rules and the 750 ceiling', () => {
    assert.match(SYSTEM, /750 is a hard ceiling/);
    assert.match(SYSTEM, /Town, day and time for every pick, and the cost when you have it/);
    assert.match(SYSTEM, /If a pick has requirements \(registration, residents only, RSVP, an age limit, pay ahead, rain cancels\), say so in the same breath/);
    assert.match(SYSTEM, /Never make unbacked logistics claims/);
    assert.match(SYSTEM, /A price, time, age rule or requirement belongs only to the row it came with/);
    assert.match(SYSTEM, /Never invent a place, event, time, price, performer or detail/);
  });

  it('never tells the model to ask their name in the first reply', () => {
    assert.match(SYSTEM, /never ask in your first reply of a conversation/);
    assert.doesNotMatch(SYSTEM, /ask once per conversation, casually/);
    assert.match(nameAskBit({ priorReplies: 0 }), /do not ask their name/);
    assert.match(nameAskBit({}), /do not ask their name/, 'missing count counts as the first reply');
    assert.match(describeProfile({ isNew: true, priorReplies: 0 }), /first reply in this conversation: do not ask their name/);
  });

  it('allows one casual ask on the second or third reply', () => {
    for (const n of [1, 2]) assert.match(nameAskBit({ priorReplies: n }), /You may ask their name once/);
  });

  it('never asks again once asked, and stops offering after the third reply', () => {
    for (const n of [0, 1, 2, 5]) assert.match(nameAskBit({ priorReplies: n, askedName: true }), /already asked their name.*do not ask again/);
    assert.match(nameAskBit({ priorReplies: 3 }), /Don't ask their name/);
    assert.doesNotMatch(nameAskBit({ priorReplies: 3 }), /may ask/);
  });

  it('says nothing about asking once the name is known', () => {
    assert.strictEqual(nameAskBit({ firstName: 'Sam', priorReplies: 1 }), '');
    assert.doesNotMatch(describeProfile({ firstName: 'Sam', priorReplies: 1 }), /may ask their name/);
  });

  it('first text reacts first and folds the intro in after, with no template to copy', () => {
    const d = describeProfile({ isNew: true });
    assert.match(d, /React to what they said or answer it first/);
    assert.match(d, /Never make the name your opening words/);
    assert.match(d, /no tagline or self-description/);
    assert.match(d, /Use your own words/);
    assert.doesNotMatch(d, /like "Exit 163 here"/, 'no single copyable opener');
    assert.doesNotMatch(d, /Ooh|Oh nice|[Ss]adly|Unfortunately/);
    // The example shapes (quoted mid-sentence fragments) never open with the name.
    const shapes = d.match(/"\.\.\.[^"]*Exit 163[^"]*"/g);
    assert.ok(shapes.length >= 2);
    for (const ex of shapes) assert.match(ex, /^"\.\.\.\s*\S/, `example ${ex} should follow other words`);
  });

  it('first-text intro is first person and bans third-person self-reference', () => {
    const d = describeProfile({ isNew: true });
    assert.match(d, /The intro is first person and plain: "I'm Exit 163" or "this is Exit 163"/);
    assert.match(d, /never refer to Exit 163 in the third person/);
    for (const w of ['"Exit 163 votes for"', '"Exit 163 has you covered"', '"Exit 163 can confirm"', '"Exit 163\'s pick"', '"Exit 163 approves"', '"Exit 163 would point you"', '"here at Exit 163"', '"you\'ve got Exit 163"']) {
      assert.ok(d.includes(w), `should ban ${w}`);
    }
    assert.match(d, /Never comment on it being their first text/);
  });

  it('bans "sadly" and "the good news is" anywhere, not just as an opener', () => {
    assert.match(SYSTEM, /"sadly", "unfortunately", "the good news is" and "the bad news is" are banned anywhere in a reply, not just as the first word/);
  });

  it('bans list lead-ins anywhere, and "every other day" unless it alternates', () => {
    assert.match(SYSTEM, /never lead into a list with "here are a few", "here are some"/);
    assert.match(SYSTEM, /daily Nov 22 to 28 except Thanksgiving/);
    assert.match(SYSTEM, /Never say "every other day" unless the details say it alternates/);
  });

  it('discourages "A few that stand out:" style list lead-ins', () => {
    for (const w of ['"A few that stand out:"', '"a few standouts"', '"here\'s a quick taste"']) assert.ok(SYSTEM.includes(w), `should discourage ${w}`);
  });

  it('first-text intro gives no "by the way" example and asks for a varied shape', () => {
    const d = describeProfile({ isNew: true });
    assert.doesNotMatch(d, /\(Exit 163, by the way\)/);
    for (const ex of d.match(/"[^"]*Exit 163[^"]*"/g)) assert.doesNotMatch(ex, /by the way|\bbtw\b/i, `example ${ex}`);
    assert.match(d, /Don't introduce yourself with "by the way" or "btw"/);
    assert.match(d, /never the same intro shape every time/);
  });
});

describe('Agent - every-other-day guard', () => {
  const { fixEveryOtherDay } = require('../lib/agent.js');
  const paperMoon = { events: [{ title: 'Paper Moon', when: 'daily Sun, Nov 22 - Sat, Nov 28, closed Thu, Nov 26', except: 'Thu, Nov 26', about: 'A musical at the Williams Center.' }] };

  it('rewrites to "every day except" when a result has a closed day', () => {
    const r = fixEveryOtherDay('Paper Moon plays every other day from Sun Nov 22 to Sat Nov 28.', [paperMoon]);
    assert.strictEqual(r, 'Paper Moon plays every day except Thu, Nov 26 from Sun Nov 22 to Sat Nov 28.');
  });

  it('rewrites to "every day" when no result has a closed day', () => {
    const r = fixEveryOtherDay('Every other day through Sunday, 7pm.', [{ events: [{ title: 'Lights', when: 'Daily Nov 20-29' }] }]);
    assert.strictEqual(r, 'Every day through Sunday, 7pm.');
    assert.strictEqual(fixEveryOtherDay('It runs every other day.', []), 'It runs every day.');
  });

  it('leaves a genuinely alternating event alone', () => {
    const alt = [{ events: [{ title: 'Pickup Soccer', when: 'Every other day, Nov 1-30' }] }];
    assert.strictEqual(fixEveryOtherDay('Pickup Soccer runs every other day.', alt), 'Pickup Soccer runs every other day.');
    const desc = [{ events: [{ title: 'Yoga', about: 'Classes alternate between the park and the library.' }] }];
    assert.strictEqual(fixEveryOtherDay('Yoga is every other day.', desc), 'Yoga is every other day.');
  });

  it('leaves replies without the phrase untouched', () => {
    assert.strictEqual(fixEveryOtherDay('Daily Nov 22 to 28, closed Thanksgiving.', [paperMoon]), 'Daily Nov 22 to 28, closed Thanksgiving.');
  });
});
