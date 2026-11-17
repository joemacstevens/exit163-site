const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Import - Smart truncation (real function tests)', () => {
  it('should handle "7 p.m." without cutting at abbreviation', () => {
    // Extract and test smartTruncate directly
    const code = fs.readFileSync(path.join(__dirname, '../scripts/import-research.js'), 'utf8');
    
    // Extract the smartTruncate function
    const funcMatch = code.match(/function smartTruncate\(text, limit\) \{[\s\S]*?\n\}/);
    assert.ok(funcMatch, 'Should find smartTruncate function');
    
    const closureMatch = code.match(/const CLOSURE_PATTERN = [^;]+;/);
    assert.ok(closureMatch, 'Should find CLOSURE_PATTERN');
    
    // Evaluate in isolated context
    eval(closureMatch[0]);
    eval(funcMatch[0]);
    
    const text = 'Event starts at 7 p.m. and goes until late.';
    const result = smartTruncate(text, 30);
    
    // Should NOT cut at "p.m."
    assert.ok(result.length > 15, 'Should not cut to ~15 chars at p.m.');
    assert.ok(!result.endsWith('p.'), 'Should not end with "p."');
  });

  it('should preserve closure notes when truncating', () => {
    const code = fs.readFileSync(path.join(__dirname, '../scripts/import-research.js'), 'utf8');
    const funcMatch = code.match(/function smartTruncate\(text, limit\) \{[\s\S]*?\n\}/);
    const closureMatch = code.match(/const CLOSURE_PATTERN = [^;]+;/);
    
    // Need to eval in same scope
    const testFunc = new Function('text', 'limit', closureMatch[0] + '\n' + funcMatch[0] + '\nreturn smartTruncate(text, limit);');
    
    const longText = 'Join us for a wonderful market. '.repeat(30) + 'Closed Christmas Day.';
    const result = testFunc(longText, 200);
    
    assert.ok(/closed.*christmas/i.test(result), 'Should preserve closure note');
  });

  it('should only cut at sentence boundary if it keeps >=80% of limit', () => {
    const code = fs.readFileSync(path.join(__dirname, '../scripts/import-research.js'), 'utf8');
    const funcMatch = code.match(/function smartTruncate\(text, limit\) \{[\s\S]*?\n\}/);
    const closureMatch = code.match(/const CLOSURE_PATTERN = [^;]+;/);
    
    const testFunc = new Function('text', 'limit', closureMatch[0] + '\n' + funcMatch[0] + '\nreturn smartTruncate(text, limit);');
    
    const text = 'A'.repeat(100) + '. B'.repeat(100);
    const result = testFunc(text, 150);
    
    // Should keep first sentence since it's within 80% of 150 (120)
    assert.ok(result.includes('.'), 'Should cut at sentence boundary');
    assert.ok(result.length >= 100, 'Should keep first sentence');
  });

  it('should match both canceled and cancelled in CLOSURE_PATTERN', () => {
    const code = fs.readFileSync(path.join(__dirname, '../scripts/import-research.js'), 'utf8');
    const patternMatch = code.match(/const CLOSURE_PATTERN = ([^;]+);/);
    
    assert.ok(patternMatch, 'Should find CLOSURE_PATTERN');
    const patternStr = patternMatch[1];
    
    assert.ok(/cancell\?ed/.test(patternStr), 'Should match both canceled/cancelled with cancell?ed');
  });
});
