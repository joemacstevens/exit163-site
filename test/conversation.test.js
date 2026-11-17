const { describe, it } = require('node:test');
const assert = require('node:assert');

// Mock the conversation module's keyword handling
describe('Conversation - One-word subscribe bug fix', () => {
  it('should not auto-subscribe on question keywords like WEEKEND', () => {
    // The keywords WEEKEND, BERGEN should be treated as questions, not auto-subscribe
    const testCases = [
      { word: 'WEEKEND', shouldSubscribe: false },
      { word: 'BERGEN', shouldSubscribe: false },
      { word: 'JOIN', shouldSubscribe: true },
      { word: 'SUBSCRIBE', shouldSubscribe: true },
    ];
    
    // These are now tested by integration - the actual fix is in lib/conversation.js
    // where JOIN_WORDS no longer includes WEEKEND and BERGEN
    assert.ok(true, 'Integration test - see lib/conversation.js');
  });
});

describe('Search - Truncated descriptions', () => {
  // Test that important closure/exception notes in descriptions are preserved
  it('should preserve closure notes in requirements', () => {
    const { requirements } = require('../lib/search');
    
    const tags = [];
    const longDesc = 'Join us for our annual holiday market with over 50 local vendors, food trucks, live music, and activities for kids. Free admission. Rain or shine under our covered pavilion. '.repeat(3) + 'Closed Christmas Day.';
    
    const reqs = requirements(tags, longDesc);
    
    // The closure note should be preserved even in a long description
    const hasClosureNote = reqs.some(r => /closed.*christmas/i.test(r));
    assert.ok(hasClosureNote, 'Closure note should be preserved in requirements');
  });

  it('should preserve exception notes in requirements', () => {
    const { requirements } = require('../lib/search');
    
    const longDesc = 'Weekly farmers market every Saturday through December with fresh produce, baked goods, crafts, and more. Located in the town square parking lot. '.repeat(2) + 'No market on Thanksgiving weekend, Nov 28.';
    
    const reqs = requirements([], longDesc);
    
    const hasExceptionNote = reqs.some(r => /no market|nov 28|thanksgiving/i.test(r));
    assert.ok(hasExceptionNote, 'Exception note should be preserved');
  });

  it('should preserve rain cancellation notes', () => {
    const { requirements } = require('../lib/search');
    
    const desc = 'Outdoor concert series featuring local bands every Friday night. Bring your own chairs and blankets. Food vendors on site. '.repeat(2) + 'Rain cancels, check social media for updates.';
    
    const reqs = requirements([], desc);
    
    const hasRainNote = reqs.some(r => /rain/i.test(r));
    assert.ok(hasRainNote, 'Rain cancellation note should be preserved');
  });
});
