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

  it('first-text greeting is in their own words, with no template to copy', () => {
    const d = describeProfile({ isNew: true });
    assert.match(d, /in your own words/);
    assert.doesNotMatch(d, /Exit 163 here/);
    assert.doesNotMatch(d, /Ooh|Oh nice/);
  });
});
