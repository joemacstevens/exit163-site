const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Agent - Prompt improvements', () => {
  // Light smoke check that key prompt improvements are present
  const agentCode = fs.readFileSync(path.join(__dirname, '../lib/agent.js'), 'utf8');
  
  it('should have greeting variation rule', () => {
    assert.ok(agentCode.includes('Vary how you open'), 'Should mention varying greetings');
    assert.ok(agentCode.includes('never start two replies the same way'), 'Should forbid repetition');
  });

  it('should limit no-guessing rule to logistics', () => {
    // The rule should be about logistics/practical claims, not blocking "why it's great"
    const hasLogisticsRule = /unbacked logistics claims/i.test(agentCode) || 
                             /logistics.*unless.*data/i.test(agentCode);
    assert.ok(hasLogisticsRule, 'Should have logistics-specific no-guessing rule');
    
    // Should allow saying why picks are great based on what they offer
    const allowsGreatness = /why.*great.*based on what it offers/i.test(agentCode) ||
                            /say why.*great/i.test(agentCode);
    assert.ok(allowsGreatness, 'Should allow saying why picks are great');
  });
});
