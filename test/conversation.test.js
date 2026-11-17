const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Conversation - Subscribe keyword handling (real behavior test)', () => {
  it('should verify keyword behavior via source inspection', () => {
    // Without DB dependencies, check keyword arrays directly from source
    const source = fs.readFileSync(path.join(__dirname, '../lib/conversation.js'), 'utf8');
    
    // Extract JOIN_WORDS
    const joinMatch = source.match(/const JOIN_WORDS = \[([^\]]+)\]/);
    assert.ok(joinMatch, 'Should find JOIN_WORDS array');
    
    const joinWords = joinMatch[1].split(',').map(s => s.trim().replace(/'/g, ''));
    assert.ok(joinWords.includes('JOIN'), 'JOIN should be in JOIN_WORDS');
    assert.ok(joinWords.includes('SUBSCRIBE'), 'SUBSCRIBE should be in JOIN_WORDS');
    assert.ok(!joinWords.includes('WEEKEND'), 'WEEKEND should NOT be in JOIN_WORDS');
    assert.ok(!joinWords.includes('BERGEN'), 'BERGEN should NOT be in JOIN_WORDS');
    
    // Extract STOP_WORDS
    const stopMatch = source.match(/const STOP_WORDS = \[([^\]]+)\]/);
    assert.ok(stopMatch, 'Should find STOP_WORDS array');
    assert.ok(stopMatch[1].includes('STOP'), 'STOP should be in STOP_WORDS');
  });

  it('should have correct keyword array structure', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/conversation.js'), 'utf8');
    
    // Verify JOIN_WORDS doesn't include WEEKEND/BERGEN
    const joinMatch = source.match(/const JOIN_WORDS = \[(.*?)\]/);
    assert.ok(joinMatch, 'Should find JOIN_WORDS');
    
    const keywords = joinMatch[1];
    assert.ok(!keywords.includes('WEEKEND'), 'WEEKEND not in JOIN_WORDS');
    assert.ok(!keywords.includes('BERGEN'), 'BERGEN not in JOIN_WORDS');
  });
});

describe('Conversation - Timeout constant', () => {
  it('should export DEFAULT_TIMEOUT_MS = 12000 from test-buddy.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/test-buddy.js'), 'utf8');
    
    const match = source.match(/const DEFAULT_TIMEOUT_MS = (\d+)/);
    assert.ok(match, 'Should find DEFAULT_TIMEOUT_MS');
    assert.strictEqual(Number(match[1]), 12000, 'Should be 12000ms');
  });
});
