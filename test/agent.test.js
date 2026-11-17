const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Agent - Prompt fixes', () => {
  // Read the agent file directly to check prompt without loading dependencies
  const agentCode = fs.readFileSync(path.join(__dirname, '../lib/agent.js'), 'utf8');
  
  it('should have varied greeting only for first message', () => {
    // Check that the prompt mentions varying greetings
    assert.ok(agentCode.includes('Vary how you open'), 'Prompt should mention varying greetings');
    assert.ok(agentCode.includes('never start two replies the same way'), 'Prompt should forbid repetitive openings');
    
    // Check that first message greeting is conditional
    const hasFirstMessageRule = /first text ever.*short.*hello/i.test(agentCode);
    assert.ok(hasFirstMessageRule, 'Prompt should have first message greeting rule');
    
    // Check that the canned greeting is discouraged
    assert.ok(/avoid.*canned.*"Hey! Exit 163 here\."/i.test(agentCode) || 
              /especially avoid.*"Hey! Exit 163 here\."/i.test(agentCode),
      'Prompt should discourage canned "Hey! Exit 163 here." greeting');
  });

  it('should forbid unbacked filler claims', () => {
    // Check for the rule about not making unbacked claims
    assert.ok(agentCode.includes('get there early') || agentCode.includes('it fills up fast'), 
      'Prompt should mention common filler phrases to avoid');
    assert.ok(/unless.*data.*says/i.test(agentCode) || /data explicitly says/i.test(agentCode), 
      'Prompt should require data backing for claims');
  });

  it('should vary follow-up offers', () => {
    // Check that follow-ups shouldn't be repeated identically
    assert.ok(/don'?t (?:end every|repeat).*(?:question|follow)/i.test(agentCode) ||
              /Vary your follow-up/i.test(agentCode),
      'Prompt should mention not repeating questions');
  });

  it('should tell when data is missing instead of guessing', () => {
    // Should say when data doesn't cover something
    const hasMissingDataRule = /(?:past|future date).*not.*covered.*say so/i.test(agentCode) ||
                                /say so plainly instead of guess/i.test(agentCode);
    assert.ok(hasMissingDataRule, 'Prompt should handle missing data explicitly');
  });
});
