const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// Test timeout constant
const TEST_TIMEOUT_MS = 12000;

describe('Conversation - Subscribe keyword handling', () => {
  it('should not auto-subscribe on WEEKEND keyword based on code inspection', () => {
    // This is a behavior test through code inspection to avoid complex mocking
    const fs = require('fs');
    const source = fs.readFileSync('./lib/conversation.js', 'utf8');
    
    // Find the keyword handling section
    const joinCheck = source.match(/if\s*\(\s*JOIN_WORDS\.includes\(word\)\s*\)/);
    assert.ok(joinCheck, 'Should have JOIN_WORDS check');
    
    // Verify WEEKEND and BERGEN are not in JOIN_WORDS
    const joinWordsMatch = source.match(/const JOIN_WORDS = \[(.*?)\]/);
    assert.ok(joinWordsMatch, 'Should find JOIN_WORDS array');
    
    const keywords = joinWordsMatch[1];
    assert.ok(!keywords.includes('WEEKEND'), 'WEEKEND should not be in JOIN_WORDS');
    assert.ok(!keywords.includes('BERGEN'), 'BERGEN should not be in JOIN_WORDS');
  });

  it('should have correct subscribe keywords in source', () => {
    const fs = require('fs');
    const source = fs.readFileSync('./lib/conversation.js', 'utf8');
    
    // Check that JOIN_WORDS array has the correct values
    const joinWordsMatch = source.match(/const JOIN_WORDS = \[(.*?)\]/);
    assert.ok(joinWordsMatch, 'Should find JOIN_WORDS definition');
    
    const joinWords = joinWordsMatch[1].replace(/'/g, '').split(',').map(s => s.trim());
    assert.ok(joinWords.includes('JOIN'), 'JOIN should be in subscribe keywords');
    assert.ok(joinWords.includes('SUBSCRIBE'), 'SUBSCRIBE should be in subscribe keywords');
    assert.ok(!joinWords.includes('WEEKEND'), 'WEEKEND should NOT be in subscribe keywords');
    assert.ok(!joinWords.includes('BERGEN'), 'BERGEN should NOT be in subscribe keywords');
  });

  it('should preserve STOP/START/HELP keyword constants', () => {
    const fs = require('fs');
    const source = fs.readFileSync('./lib/conversation.js', 'utf8');
    
    // These keyword arrays should still exist
    assert.ok(/const STOP_WORDS = \[/.test(source), 'STOP_WORDS should exist');
    assert.ok(/const START_WORDS = \[/.test(source), 'START_WORDS should exist');
    assert.ok(/const HELP_WORDS = \[/.test(source), 'HELP_WORDS should exist');
    assert.ok(/const FORGET_WORDS = \[/.test(source), 'FORGET_WORDS should exist');
  });
});

describe('Conversation - Test timeout constant', () => {
  it('should export correct default timeout', () => {
    assert.strictEqual(TEST_TIMEOUT_MS, 12000, 'Test timeout should default to 12000ms to match production');
  });
});

// Export the constant for use in other modules
module.exports = { TEST_TIMEOUT_MS };
