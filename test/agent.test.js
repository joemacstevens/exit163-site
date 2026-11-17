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
