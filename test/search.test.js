const { describe, it } = require('node:test');
const assert = require('node:assert');
const { words, stem, parseQuery, indexRow, scoreRow, parseRecurrence, occurrences, requirements } = require('../lib/search');

describe('Search - Boxing term mapping', () => {
  it('should match boxing/boxer/boxers to same canonical term', () => {
    assert.strictEqual(stem('boxing'), 'boxing:term');
    assert.strictEqual(stem('boxer'), 'boxing:term');
    assert.strictEqual(stem('boxers'), 'boxing:term');
    assert.strictEqual(stem('kickboxing'), 'boxing:term');
  });

  it('should match "boxing" query to boxing events', () => {
    const boxingEvent = indexRow({ title: 'Boxing Night', tags: ['boxing', 'sports'], about: 'Professional boxing matches' });
    const concepts = parseQuery('boxing');
    const score = scoreRow(boxingEvent, concepts);
    
    assert.ok(score.score > 0, 'Boxing event should match');
    assert.ok(score.matched > 0, 'Should have matched concepts');
  });

  it('should match "boxer" query to boxing events', () => {
    const boxingEvent = indexRow({ title: 'Boxing Championship', tags: ['boxing'], about: 'watch professional boxers compete' });
    const concepts = parseQuery('boxer');
    const score = scoreRow(boxingEvent, concepts);
    
    assert.ok(score.score > 0, 'Boxing event should match boxer query');
  });

  it('should not match "box" to boxing events', () => {
    const boxingEvent = indexRow({ title: 'Boxing Night', tags: ['boxing'], about: 'boxing match' });
    const boxConcepts = parseQuery('box');
    const score = scoreRow(boxingEvent, boxConcepts);
    
    // 'box' stems to 'box', 'boxing' stems to 'boxing:term' - no match
    assert.strictEqual(score.score, 0, 'Plain "box" should not match boxing');
  });

  it('should not match "boxing" to Black Box theater', () => {
    const blackBoxTheater = indexRow({ title: 'Black Box Theatre Show', tags: ['theater'], about: 'intimate theater performance in black box venue' });
    const concepts = parseQuery('boxing');
    const score = scoreRow(blackBoxTheater, concepts);
    
    assert.strictEqual(score.score, 0, 'Black Box theater should not match boxing query');
  });

  it('should not match unrelated box words', () => {
    const busterBox = indexRow({ title: 'Buster Box Story Time', tags: ['kids', 'library'], about: 'library event with activity boxes' });
    const concepts = parseQuery('boxing');
    const score = scoreRow(busterBox, concepts);
    
    assert.strictEqual(score.score, 0, 'Buster Box should not match boxing query');
  });
});

describe('Search - Recurrence exceptions', () => {
  it('should parse exception dates from recurrence text', () => {
    const rec = parseRecurrence('nightly Nov 21–Jan 3 except Dec 24-25', '2024-11-21', '2025-01-03');
    assert.ok(rec, 'Should parse recurrence with exceptions');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-12-24'), 'Should include Dec 24');
    assert.ok(rec.except.includes('2024-12-25'), 'Should include Dec 25');
  });

  it('should parse Christmas Day exception', () => {
    const rec = parseRecurrence('Daily Dec 20-30. Closed Christmas Day', '2024-12-20', '2024-12-30');
    assert.ok(rec, 'Should parse recurrence');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-12-25'), 'Should include Dec 25');
  });

  it('should parse Christmas Eve exception without matching Christmas Day', () => {
    const rec = parseRecurrence('Daily Dec 20-30 except Christmas Eve', '2024-12-20', '2024-12-30');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-12-24'), 'Should include Dec 24');
    assert.ok(!rec.except.includes('2024-12-25'), 'Should NOT include Dec 25');
  });

  it('should parse New Year\'s Eve exception', () => {
    const rec = parseRecurrence('Daily Dec 20 - Jan 5. Closed New Year\'s Eve', '2024-12-20', '2025-01-05');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2024-12-31'), 'Should include Dec 31 (NYE), not Jan 1');
    assert.ok(!rec.except.includes('2025-01-01'), 'Should NOT include Jan 1');
  });

  it('should parse New Year\'s Day exception', () => {
    const rec = parseRecurrence('Daily Dec 20 - Jan 10. Closed New Year\'s Day', '2024-12-20', '2025-01-10');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2025-01-01'), 'Should include Jan 1');
  });

  it('should calculate holiday year within event date range', () => {
    // Event in early 2027 should exclude 2027-01-01, not 2026-01-01
    const rec = parseRecurrence('Daily Jan 1 - Mar 1. Closed New Year\'s Day', '2027-01-01', '2027-03-01');
    assert.ok(rec.except, 'Should have except array');
    assert.ok(rec.except.includes('2027-01-01'), 'Should include 2027-01-01 for event in 2027');
  });

  it('should parse text starting with exception clause', () => {
    const rec = parseRecurrence('Closed Mondays. Open Tue-Sun Nov 20-Jan 4', '2024-11-20', '2025-01-04');
    assert.ok(rec, 'Should parse when exception comes first');
    assert.strictEqual(rec.type, 'weekly', 'Should be weekly pattern');
    assert.ok(rec.exceptDays, 'Should have exceptDays');
    assert.ok(rec.exceptDays.includes(1), 'Should exclude Monday (day 1)');
  });

  it('should parse weekday exceptions', () => {
    const rec = parseRecurrence('Daily Nov 1-30 except Tuesdays', '2024-11-01', '2024-11-30');
    assert.ok(rec.exceptDays, 'Should have exceptDays');
    assert.ok(rec.exceptDays.includes(2), 'Should exclude Tuesday (day 2)');
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

  it('should filter excluded weekdays from weekly occurrences', () => {
    const event = {
      starts_on: '2024-11-01',
      ends_on: '2024-11-30',
      recurrence_text: 'Open daily. Closed Mondays',
    };
    const { dates } = occurrences(event, '2024-11-01', '2024-11-30');
    
    // Check that no Mondays are included (Nov 4, 11, 18, 25 are Mondays)
    assert.ok(!dates.includes('2024-11-04'), 'Monday Nov 4 should be excluded');
    assert.ok(!dates.includes('2024-11-11'), 'Monday Nov 11 should be excluded');
    assert.ok(!dates.includes('2024-11-18'), 'Monday Nov 18 should be excluded');
    assert.ok(!dates.includes('2024-11-25'), 'Monday Nov 25 should be excluded');
    
    // But Tuesdays should be included
    assert.ok(dates.includes('2024-11-05'), 'Tuesday Nov 5 should be included');
  });
});

describe('Search - Requirements with cap', () => {
  it('should preserve closure notes in requirements', () => {
    const tags = [];
    const longDesc = 'Join us for our annual holiday market with over 50 local vendors, food trucks, live music, and activities for kids. Free admission. Rain or shine under our covered pavilion. '.repeat(3) + 'Closed Christmas Day.';
    
    const reqs = requirements(tags, longDesc);
    
    const hasClosureNote = reqs.some(r => /closed.*christmas/i.test(r));
    assert.ok(hasClosureNote, 'Closure note should be preserved in requirements');
  });

  it('should preserve exception notes in requirements', () => {
    const longDesc = 'Weekly farmers market every Saturday through December with fresh produce, baked goods, crafts, and more. Located in the town square parking lot. '.repeat(2) + 'No market on Thanksgiving weekend, Nov 28.';
    
    const reqs = requirements([], longDesc);
    
    const hasExceptionNote = reqs.some(r => /no market|nov 28|thanksgiving/i.test(r));
    assert.ok(hasExceptionNote, 'Exception note should be preserved');
  });

  it('should preserve rain cancellation notes', () => {
    const desc = 'Outdoor concert series featuring local bands every Friday night. Bring your own chairs and blankets. Food vendors on site. '.repeat(2) + 'Rain cancels, check social media for updates.';
    
    const reqs = requirements([], desc);
    
    const hasRainNote = reqs.some(r => /rain/i.test(r));
    assert.ok(hasRainNote, 'Rain cancellation note should be preserved');
  });

  it('should enforce maximum sentence count', () => {
    const desc = 'Registration required. RSVP online. Ages 18+. Cash only. Limited space. Reservations recommended. Must book ahead. Weather permitting. Rain cancels. Closed holidays.';
    const reqs = requirements([], desc);
    
    // Should have at most 3 requirement sentences plus tags
    const sentences = reqs.filter(r => r.length > 20); // filter out short tags
    assert.ok(sentences.length <= 3, `Should have at most 3 sentences, got ${sentences.length}`);
  });

  it('should enforce maximum total character count', () => {
    const veryLongDesc = 'Registration is required for all participants and must be completed at least 48 hours in advance through our website. '.repeat(10) + 'Rain cancels the event.';
    const reqs = requirements([], veryLongDesc);
    
    const totalChars = reqs.join(' ').length;
    assert.ok(totalChars <= 450, `Total requirements should be under 450 chars, got ${totalChars}`);
  });

  it('should prioritize closure notes over regular requirements', () => {
    const desc = 'Registration required. Must RSVP. Ages 21+. '.repeat(3) + 'Closed Christmas Day and New Year\'s Day.';
    const reqs = requirements([], desc);
    
    // The closure note should be included despite many other requirements
    const hasClosureNote = reqs.some(r => /closed.*christmas/i.test(r));
    assert.ok(hasClosureNote, 'Closure note should be prioritized');
  });
});
