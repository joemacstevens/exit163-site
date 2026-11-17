const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { words, stem, parseQuery, indexRow, scoreRow, parseRecurrence, occurrences, requirements } = require(path.join(__dirname, '../lib/search'));

describe('Search - Boxing term mapping', () => {
  it('should map boxing variants to same canonical term', () => {
    assert.strictEqual(stem('boxing'), 'boxing:term');
    assert.strictEqual(stem('boxer'), 'boxing:term');
    assert.strictEqual(stem('boxers'), 'boxing:term');
    assert.strictEqual(stem('kickboxing'), 'boxing:term');
    assert.strictEqual(stem('kickboxer'), 'boxing:term');
    assert.strictEqual(stem('kickboxers'), 'boxing:term');
  });

  it('should match boxing query to boxing events', () => {
    const boxingEvent = indexRow({ title: 'Boxing Night', tags: ['boxing', 'sports'], about: 'Professional boxing matches' });
    const concepts = parseQuery('boxing');
    const score = scoreRow(boxingEvent, concepts);
    
    assert.ok(score.score > 0, 'Boxing event should match');
  });

  it('should not match plain box to boxing', () => {
    const boxingEvent = indexRow({ title: 'Boxing Night', tags: ['boxing'] });
    const boxConcepts = parseQuery('box');
    const score = scoreRow(boxingEvent, boxConcepts);
    
    assert.strictEqual(score.score, 0, '"box" should not match boxing');
  });

  it('should not match Black Box theater to boxing query', () => {
    const theater = indexRow({ title: 'Black Box Theatre', tags: ['theater'] });
    const concepts = parseQuery('boxing');
    
    assert.strictEqual(scoreRow(theater, concepts).score, 0);
  });
});

describe('Search - Recurrence exceptions (B1-B3 blocking issues)', () => {
  it('B1: should not swallow date span when exception comes first', () => {
    // 'Daily except Mondays, Nov 20 – Jan 4'
    const event = {
      starts_on: '2024-11-20',
      ends_on: '2025-01-04',
      recurrence_text: 'Daily except Mondays, Nov 20 – Jan 4',
    };
    const { dates } = occurrences(event, '2024-11-20', '2025-01-04');
    
    assert.ok(dates.length > 0, 'Should have dates - exception clause must end at comma');
    assert.ok(dates.includes('2024-11-20'), 'Should include Nov 20');
    assert.ok(dates.includes('2024-12-25'), 'Should include Dec 25');
  });

  it('B1: should preserve date span with exception in middle', () => {
    // 'Open Tue–Sun, closed Mon, Nov 20–Jan 4'
    const event = {
      starts_on: '2024-11-20',
      ends_on: '2025-01-04',
      recurrence_text: 'Open Tue–Sun, closed Mon, Nov 20–Jan 4',
    };
    const { dates } = occurrences(event, '2024-11-20', '2025-01-04');
    
    assert.ok(dates.length > 0, 'Should have dates');
  });

  it('B2: should not exclude all Saturdays when exception has specific date', () => {
    // 'Saturdays Nov 7–Dec 19 except Sat Nov 28'
    const rec = parseRecurrence('Saturdays Nov 7–Dec 19 except Sat Nov 28', '2024-11-07', '2024-12-19');
    const event = {
      starts_on: '2024-11-07',
      ends_on: '2024-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 except Sat Nov 28',
    };
    const { dates } = occurrences(event, '2024-11-07', '2024-12-19');
    
    // Should include other Saturdays
    assert.ok(dates.includes('2024-11-09'), 'Should include Nov 9 (Sat)');
    assert.ok(dates.includes('2024-12-07'), 'Should include Dec 7 (Sat)');
    // Should exclude only Nov 28
    assert.ok(!dates.includes('2024-11-28'), 'Should exclude Nov 28');
  });

  it('B3: should apply exceptDays to date-range patterns', () => {
    // 'Daily Nov 1–30 except Tuesdays'
    const event = {
      starts_on: '2024-11-01',
      ends_on: '2024-11-30',
      recurrence_text: 'Daily Nov 1–30 except Tuesdays',
    };
    const { dates } = occurrences(event, '2024-11-01', '2024-11-30');
    
    // Nov 5, 12, 19, 26 are Tuesdays - should be excluded
    assert.ok(!dates.includes('2024-11-05'), 'Should exclude Tuesday Nov 5');
    assert.ok(!dates.includes('2024-11-12'), 'Should exclude Tuesday Nov 12');
    assert.ok(!dates.includes('2024-11-19'), 'Should exclude Tuesday Nov 19');
    
    // Mondays should be included
    assert.ok(dates.includes('2024-11-04'), 'Should include Monday Nov 4');
    assert.ok(dates.includes('2024-11-11'), 'Should include Monday Nov 11');
  });

  it('Issue 7: should parse "Closed Mondays, open Tue–Sun Nov 20–Jan 4"', () => {
    const event = {
      starts_on: '2024-11-20',
      ends_on: '2025-01-04',
      recurrence_text: 'Closed Mondays, open Tue–Sun Nov 20–Jan 4',
    };
    const { dates } = occurrences(event, '2024-11-20', '2025-01-04');
    
    assert.ok(dates.length > 0, 'Should parse successfully');
    // Nov 25, Dec 2, 9, 16, 23, 30 are Mondays - should be excluded
    assert.ok(!dates.includes('2024-11-25'), 'Should exclude Monday');
    // Tuesdays should be included
    assert.ok(dates.includes('2024-11-26'), 'Should include Tuesday');
  });

  it('should normalize curly apostrophes', () => {
    // Test that curly apostrophes are normalized (pattern matching should work)
    const textWithCurly = 'Daily Dec 20 - Jan 5. Closed New Year' + String.fromCharCode(8217) + 's Day';
    const rec = parseRecurrence(textWithCurly, '2024-12-20', '2025-01-05');
    
    assert.ok(rec.except, 'Should parse with curly apostrophe');
    assert.ok(rec.except.length > 0, 'Should have exceptions');
  });

  it('should recognize Thanksgiving', () => {
    // Thanksgiving 2024 is Nov 28 (4th Thursday)
    const rec = parseRecurrence('Daily Nov 1-30. Closed Thanksgiving', '2024-11-01', '2024-11-30');
    
    assert.ok(rec.except, 'Should parse Thanksgiving');
    assert.ok(rec.except.includes('2024-11-28'), 'Should exclude Nov 28 (Thanksgiving 2024)');
  });

  it('should filter excluded dates from occurrences', () => {
    const event = {
      starts_on: '2024-12-20',
      ends_on: '2024-12-30',
      recurrence_text: 'nightly Dec 20-30 except Dec 24-25',
    };
    const { dates } = occurrences(event, '2024-12-20', '2024-12-30');
    
    assert.ok(!dates.includes('2024-12-24'), 'Dec 24 should be excluded');
    assert.ok(!dates.includes('2024-12-25'), 'Dec 25 should be excluded');
    assert.ok(dates.includes('2024-12-23'), 'Dec 23 should be included');
  });
});

describe('Search - Requirements with cap', () => {
  it('should use continue not break when sentence exceeds char limit', () => {
    // Long requirement + short closure note - should include both
    const longReq = 'Registration is required for all participants and must be completed 48 hours in advance.';
    const shortClosure = 'Rain cancels.';
    const desc = longReq + ' ' + 'X'.repeat(200) + '. ' + shortClosure;
    
    const reqs = requirements([], desc);
    
    // Should have both the long req and short closure (continue past the filler)
    const hasRain = reqs.some(r => /rain/i.test(r));
    assert.ok(hasRain, 'Should include short closure note even after skipping long sentence');
  });

  it('should match both canceled and cancelled', () => {
    const desc1 = 'Event may be canceled due to weather.';
    const desc2 = 'Event may be cancelled due to weather.';
    
    const reqs1 = requirements([], desc1);
    const reqs2 = requirements([], desc2);
    
    assert.ok(reqs1.some(r => /cancel/i.test(r)), 'Should match canceled (American spelling)');
    assert.ok(reqs2.some(r => /cancel/i.test(r)), 'Should match cancelled (British spelling)');
  });
});
