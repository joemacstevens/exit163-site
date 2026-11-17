const { describe, it } = require('node:test');
const assert = require('node:assert');
const { words, stem, parseQuery, indexRow, scoreRow, parseRecurrence, occurrences } = require('../lib/search');

describe('Search - Boxing bug fix', () => {
  it('should match "boxing" without matching unrelated "box" words', () => {
    // Index rows with different box-related words
    const boxingEvent = indexRow({ title: 'Boxing Night', tags: ['boxing', 'sports'], about: 'Professional boxing matches' });
    const blackBoxTheater = indexRow({ title: 'Black Box Theatre Show', tags: ['theater'], about: 'intimate theater performance' });
    const busterBoxLibrary = indexRow({ title: 'Buster Box Story Time', tags: ['kids', 'library'], about: 'library event with activity boxes' });
    
    const concepts = parseQuery('boxing');
    
    const boxingScore = scoreRow(boxingEvent, concepts);
    const theaterScore = scoreRow(blackBoxTheater, concepts);
    const libraryScore = scoreRow(busterBoxLibrary, concepts);
    
    // Boxing event should match strongly
    assert.ok(boxingScore.score > 0, 'Boxing event should match');
    assert.ok(boxingScore.matched > 0, 'Boxing event should have matched concepts');
    
    // Black Box and Buster Box should NOT match
    assert.strictEqual(theaterScore.score, 0, 'Black Box theater should not match boxing query');
    assert.strictEqual(libraryScore.score, 0, 'Buster Box library event should not match boxing query');
  });

  it('should match boxing-related terms', () => {
    const boxingEvent = indexRow({ title: 'Fight Night', tags: ['boxing'], about: 'watch boxers compete' });
    const concepts = parseQuery('boxing fighter');
    const score = scoreRow(boxingEvent, concepts);
    assert.ok(score.score > 0, 'Should match boxing/fighter terms');
  });
});

describe('Search - Recurrence exceptions', () => {
  it('should parse exception dates from recurrence text', () => {
    const rec1 = parseRecurrence('nightly Nov 21–Jan 3 except Dec 24-25', '2024-11-21', '2025-01-03');
    assert.ok(rec1, 'Should parse recurrence with exceptions');
    assert.ok(rec1.except, 'Should have except array');
    assert.ok(rec1.except.includes('2024-12-24'), 'Should include Dec 24');
    assert.ok(rec1.except.includes('2024-12-25'), 'Should include Dec 25');
  });

  it('should parse "closed Christmas Day" exception', () => {
    const rec = parseRecurrence('Daily Dec 20-30 closed Christmas Day', '2024-12-20', '2024-12-30');
    assert.ok(rec, 'Should parse recurrence');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-12-25'), 'Should include Dec 25');
  });

  it('should parse "except" keyword exceptions', () => {
    const rec = parseRecurrence('Weekends Nov 1 - Dec 31 except Nov 28', '2024-11-01', '2024-12-31');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-11-28'), 'Should include excepted date');
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
    assert.ok(dates.includes('2024-12-26'), 'Dec 26 should be included');
  });

  it('should handle "no shows on" exception format', () => {
    const rec = parseRecurrence('Weekly Thursdays Nov 1 - Dec 31, no shows on Nov 28', '2024-11-01', '2024-12-31');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-11-28'), 'Should include excepted date');
  });

  it('should handle "excluding" keyword', () => {
    const rec = parseRecurrence('Daily Dec 1-31 excluding Dec 25', '2024-12-01', '2024-12-31');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-12-25'), 'Should include excepted date');
  });
});
