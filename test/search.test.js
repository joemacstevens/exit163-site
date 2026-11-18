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
    // 'Saturdays Nov 7–Dec 19 except Sat Nov 28' - use 2026 where Nov 28 is Saturday
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 except Sat Nov 28',
    };
    const { dates } = occurrences(event, '2026-11-07', '2026-12-19');
    
    // Should include other Saturdays (Nov 7, 14, 21; Dec 5, 12, 19)
    assert.ok(dates.includes('2026-11-07'), 'Should include Nov 7 (Sat)');
    assert.ok(dates.includes('2026-11-14'), 'Should include Nov 14 (Sat)');
    assert.ok(dates.includes('2026-11-21'), 'Should include Nov 21 (Sat)');
    assert.ok(dates.includes('2026-12-05'), 'Should include Dec 5 (Sat)');
    assert.ok(dates.includes('2026-12-12'), 'Should include Dec 12 (Sat)');
    assert.ok(dates.includes('2026-12-19'), 'Should include Dec 19 (Sat)');
    // Should exclude only Nov 28
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Nov 28 (Sat)');
    assert.strictEqual(dates.length, 6, 'Should have 6 Saturdays total');
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

  it('Issue 2: should not exclude all Fri-Sun for "except holiday weekends"', () => {
    // 'Saturdays Nov 1–30 except holiday weekends'
    const event = {
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
      recurrence_text: 'Saturdays Nov 1–30 except holiday weekends',
    };
    const { dates } = occurrences(event, '2026-11-01', '2026-11-30');
    
    // Should NOT be empty - "weekends" should not be parsed as excluded weekdays
    assert.ok(dates.length > 0, 'Should have Saturdays, not exclude all Fri-Sun');
    // Should have Saturdays: Nov 7, 14, 21, 28
    assert.ok(dates.includes('2026-11-07'), 'Should include Sat Nov 7');
    assert.ok(dates.includes('2026-11-14'), 'Should include Sat Nov 14');
  });

  it('Issue 3: "except Sat, Nov 28" should not exclude all Saturdays', () => {
    const event = {
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
      recurrence_text: 'Saturdays except Sat, Nov 28',
    };
    const { dates } = occurrences(event, '2026-11-01', '2026-11-30');
    
    // Should include Saturdays except Nov 28
    assert.ok(dates.includes('2026-11-07'), 'Should include Sat Nov 7');
    assert.ok(dates.includes('2026-11-14'), 'Should include Sat Nov 14');
    assert.ok(dates.includes('2026-11-21'), 'Should include Sat Nov 21');
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Sat Nov 28');
    assert.strictEqual(dates.length, 3, 'Should have 3 Saturdays');
  });

  it('Issue 3: "except Sat. Nov 28" (period) should not exclude all Saturdays', () => {
    const event = {
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
      recurrence_text: 'Saturdays except Sat. Nov 28',
    };
    const { dates } = occurrences(event, '2026-11-01', '2026-11-30');
    
    // Should include Saturdays except Nov 28
    assert.ok(dates.includes('2026-11-07'), 'Should include Sat Nov 7');
    assert.ok(dates.includes('2026-11-21'), 'Should include Sat Nov 21');
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Sat Nov 28');
    assert.strictEqual(dates.length, 3, 'Should have 3 Saturdays');
  });

  it('Review 4 blocker: "Daily except Monday, Nov 20 thru Jan 4" must give every day except Mondays', () => {
    const event = {
      starts_on: '2024-11-20',
      ends_on: '2025-01-04',
      recurrence_text: 'Daily except Monday, Nov 20 thru Jan 4',
    };
    const { dates } = occurrences(event, '2024-11-20', '2025-01-04');
    
    // Should have all days Nov 20-Jan 4 except Mondays (6 Mondays in range)
    assert.ok(dates.length > 0, 'Should have dates, not zero');
    assert.strictEqual(dates.length, 40, 'Should have 40 days (46 total - 6 Mondays)');
    assert.ok(!dates.includes('2024-11-25'), 'Should exclude Mon Nov 25');
    assert.ok(!dates.includes('2024-12-02'), 'Should exclude Mon Dec 2');
    assert.ok(dates.includes('2024-11-20'), 'Should include Wed Nov 20');
    assert.ok(dates.includes('2024-11-26'), 'Should include Tue Nov 26');
  });

  it('Review 4 blocker: "Saturdays except Sat, Nov 28 - holiday" must give 6 Saturdays', () => {
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 except Sat, Nov 28 - holiday',
    };
    const { dates } = occurrences(event, '2026-11-07', '2026-12-19');
    
    // Should have 6 Saturdays (7 total minus Nov 28)
    assert.ok(dates.length > 0, 'Should have dates, not zero');
    assert.strictEqual(dates.length, 6, 'Should have 6 Saturdays');
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Nov 28');
    assert.ok(dates.includes('2026-11-07'), 'Should include Nov 7');
    assert.ok(dates.includes('2026-12-19'), 'Should include Dec 19');
  });

  it('Review 4 blocker: "Saturdays except Sat., Nov 28" (period) must give 6 Saturdays', () => {
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 except Sat., Nov 28',
    };
    const { dates } = occurrences(event, '2026-11-07', '2026-12-19');
    
    // Should have 6 Saturdays
    assert.strictEqual(dates.length, 6, 'Should have 6 Saturdays');
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Nov 28');
  });

  it('Review 4 blocker: "Daily except Monday, November 20 through January 4" with long month name', () => {
    const event = {
      starts_on: '2024-11-20',
      ends_on: '2025-01-04',
      recurrence_text: 'Daily except Monday, November 20 through January 4',
    };
    const { dates } = occurrences(event, '2024-11-20', '2025-01-04');
    
    // Should have all days except Mondays
    assert.ok(dates.length > 0, 'Should have dates, not zero');
    assert.strictEqual(dates.length, 40, 'Should have 40 days (46 total - 6 Mondays)');
  });

  it('Review 5: "closed Sat, Nov 28 until 2pm" is a date label, not a range (time is not a day)', () => {
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 closed Sat, Nov 28 until 2pm',
    };
    const { dates } = occurrences(event, '2026-11-07', '2026-12-19');
    assert.strictEqual(dates.length, 6, 'Should have 6 Saturdays');
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Nov 28');
  });

  it('Review 5: "except Sat, Nov 28 – 5pm" is a date label, not a range', () => {
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 except Sat, Nov 28 – 5pm',
    };
    const { dates } = occurrences(event, '2026-11-07', '2026-12-19');
    assert.strictEqual(dates.length, 6, 'Should have 6 Saturdays');
    assert.ok(!dates.includes('2026-11-28'), 'Should exclude Nov 28');
  });

  it('Review 5: "Daily except Monday, Nov 20 – Sun, Jan 4" (weekday after range word) is a range', () => {
    const event = {
      starts_on: '2026-11-20',
      ends_on: '2027-01-04',
      recurrence_text: 'Daily except Monday, Nov 20 – Sun, Jan 4',
    };
    const { dates } = occurrences(event, '2026-11-20', '2027-01-04');
    // 46 days Nov 20 - Jan 4, minus 7 Mondays (Nov 23, 30, Dec 7, 14, 21, 28, Jan 4)
    assert.strictEqual(dates.length, 39, 'Should have 39 days');
    assert.ok(dates.every((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 1), 'Should have no Mondays');
    assert.ok(dates.includes('2026-11-20'), 'Should include Fri Nov 20');
    assert.ok(dates.includes('2027-01-03'), 'Should include Sun Jan 3');
  });

  it('Review 5 safety net: exceptions that remove every date are ignored', () => {
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 closed Saturdays',
    };
    const { dates } = occurrences(event, '2026-11-07', '2026-12-19');
    assert.strictEqual(dates.length, 7, 'Should fall back to all 7 Saturdays');
  });

  it('Review 5 safety net: exceptions that leave some dates still apply', () => {
    const event = {
      starts_on: '2026-11-07',
      ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7–Dec 19 except Sat, Nov 28',
    };
    // Window covering only the excepted day: still excluded (net is per event, not per window)
    assert.strictEqual(occurrences(event, '2026-11-28', '2026-11-28').dates.length, 0);
    assert.strictEqual(occurrences(event, '2026-11-07', '2026-12-19').dates.length, 6);
  });

  it('Issue 1+7: should parse "Open Tue–Sun, closed Mon, Nov 20–Jan 4" with all days except Mondays', () => {
    const event = {
      starts_on: '2024-11-20',
      ends_on: '2025-01-04',
      recurrence_text: 'Open Tue–Sun, closed Mon, Nov 20–Jan 4',
    };
    const { dates } = occurrences(event, '2024-11-20', '2025-01-04');
    
    // Should have Tue–Sun: Nov 20 (Wed) through Jan 4, minus all Mondays
    // Mondays in range: Nov 25, Dec 2, 9, 16, 23, 30
    assert.ok(!dates.includes('2024-11-25'), 'Should exclude Mon Nov 25');
    assert.ok(!dates.includes('2024-12-02'), 'Should exclude Mon Dec 2');
    assert.ok(!dates.includes('2024-12-30'), 'Should exclude Mon Dec 30');
    
    // Should include all other days
    assert.ok(dates.includes('2024-11-20'), 'Should include Wed Nov 20');
    assert.ok(dates.includes('2024-11-21'), 'Should include Thu Nov 21');
    assert.ok(dates.includes('2024-11-22'), 'Should include Fri Nov 22');
    assert.ok(dates.includes('2024-11-23'), 'Should include Sat Nov 23');
    assert.ok(dates.includes('2024-11-24'), 'Should include Sun Nov 24');
    assert.ok(dates.includes('2024-11-26'), 'Should include Tue Nov 26');
    
    // Total: 46 days minus 6 Mondays = 40 days
    assert.strictEqual(dates.length, 40, 'Should have 40 days (Tue-Sun only)');
  });

  it('Issue 4: curly apostrophes in New Years Eve should exclude Dec 31 not Jan 1', () => {
    // Use Unicode curly apostrophe (U+2019)
    const textWithCurly = 'Daily Dec 20 - Jan 5. Closed New Year' + String.fromCharCode(0x2019) + 's Eve';
    const event = {
      starts_on: '2024-12-20',
      ends_on: '2025-01-05',
      recurrence_text: textWithCurly,
    };
    const { dates } = occurrences(event, '2024-12-20', '2025-01-05');
    
    // Should exclude Dec 31 (NYE), NOT Jan 1
    assert.ok(!dates.includes('2024-12-31'), 'Should exclude Dec 31 (NYE with curly apostrophe)');
    assert.ok(dates.includes('2025-01-01'), 'Should include Jan 1 (not NYE)');
    assert.ok(dates.includes('2024-12-30'), 'Should include Dec 30');
    assert.ok(dates.includes('2025-01-02'), 'Should include Jan 2');
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

describe('Search - daily runs with a closure', () => {
  const { dailySkips } = require(path.join(__dirname, '../lib/search'));
  const { shapeEvent } = require(path.join(__dirname, '../lib/tools'));

  it('finds the skipped day in a daily run, and nothing for weekly or split runs', () => {
    assert.deepStrictEqual(dailySkips(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27', '2026-11-28']), ['2026-11-26']);
    assert.deepStrictEqual(dailySkips(['2026-11-22', '2026-11-23', '2026-11-24']), []);
    assert.strictEqual(dailySkips(['2026-11-07', '2026-11-14', '2026-11-21']), null, 'weekly');
    assert.strictEqual(dailySkips(['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15']), null, 'weekends');
    assert.strictEqual(dailySkips(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-19', '2026-11-20', '2026-11-21']), null, 'two stretches');
    assert.strictEqual(dailySkips(['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-07']), null, 'alternate days');
  });

  it('shapes Paper Moon as daily Nov 22-28 except Thanksgiving', () => {
    const row = { title: 'Paper Moon', town_slug: 'ridgewood', starts_on: '2026-11-22', ends_on: '2026-11-28',
      recurrence_text: 'Daily Nov 22-28 (closed Thanksgiving)', tags: [], verified: true };
    const out = shapeEvent(row, occurrences(row, '2026-11-17', '2026-12-31'));
    assert.strictEqual(out.date, 'daily Sun, Nov 22 - Sat, Nov 28');
    assert.strictEqual(out.except, 'Thu, Nov 26');
    assert.strictEqual(out.when, 'daily Sun, Nov 22 - Sat, Nov 28, closed Thu, Nov 26');
    assert.strictEqual(out.runs, undefined, 'one phrasing, folded into when');
    assert.doesNotMatch(JSON.stringify(out), /Daily Nov 22-28 \(closed/);
  });

  it('still gives Paper Moon its daily run and except when asked about Thanksgiving alone', () => {
    const row = { title: 'Paper Moon', town_slug: 'ridgewood', starts_on: '2026-11-22', ends_on: '2026-11-28',
      recurrence_text: 'Daily Nov 22-28 (closed Thanksgiving)', tags: [], verified: true };
    const out = shapeEvent(row, occurrences(row, '2026-11-26', '2026-11-26'));
    assert.strictEqual(out.when, 'daily Sun, Nov 22 - Sat, Nov 28, closed Thu, Nov 26');
    assert.strictEqual(out.except, 'Thu, Nov 26');
    assert.strictEqual(out.runs, undefined);
    assert.doesNotMatch(JSON.stringify(out), /Daily Nov 22-28 \(closed/);
  });

  it('keeps the raw recurrence text for a weekly listing', () => {
    const row = { title: 'Saturday Market', town_slug: 'ridgewood', starts_on: '2026-11-07', ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7-Dec 19', tags: [], verified: true };
    assert.strictEqual(shapeEvent(row, occurrences(row, '2026-11-01', '2026-12-31')).when, 'Saturdays Nov 7-Dec 19');
  });

  it('leaves weekly listings as a list of dates with no except', () => {
    const row = { title: 'Saturday Market', town_slug: 'ridgewood', starts_on: '2026-11-07', ends_on: '2026-12-19',
      recurrence_text: 'Saturdays Nov 7-Dec 19', tags: [], verified: true };
    const out = shapeEvent(row, occurrences(row, '2026-11-01', '2026-12-31'));
    assert.match(out.date, /^Sat, Nov 7, Sat, Nov 14, Sat, Nov 21 \(\+\d+ more dates\)$/);
    assert.strictEqual(out.except, undefined);
  });
});

describe('Search - free events with no cost posted', () => {
  const { shapeEvent, saysFree } = require(path.join(__dirname, '../lib/tools'));
  const row = (title, description, cost_text = null) => ({ title, description, cost_text, town_slug: 'ridgewood', starts_on: '2026-11-20', tags: [], verified: true });

  it('reads "free team trivia" as free', () => {
    const out = shapeEvent(row('Joe Trivia at Five Dimes', 'Joe Trivia runs free team trivia every Thursday night.'));
    assert.strictEqual(out.cost, 'free (per the details)');
  });

  it('reads free admission and "the program is free" as free', () => {
    assert.ok(saysFree('Holiday Lights Walk', 'Free admission; bring a flashlight.'));
    assert.ok(saysFree('Story Time', 'The program is free for all.'));
    assert.ok(saysFree('Free Movie Night', null));
  });

  it('does not read gluten-free, sugar free or free parking as a free event', () => {
    assert.strictEqual(shapeEvent(row('Cookie Decorating', 'Gluten-free cookies available.')).cost, 'not posted');
    assert.strictEqual(shapeEvent(row('Cookie Decorating', 'Sugar free icing on request.')).cost, 'not posted');
    assert.strictEqual(shapeEvent(row('Craft Fair', 'Free parking in the municipal lot.')).cost, 'not posted');
    assert.strictEqual(shapeEvent(row('Craft Fair', 'Parking is free.')).cost, 'not posted');
  });

  it('keeps a posted cost as is', () => {
    assert.strictEqual(shapeEvent(row('Trivia', 'free team trivia', '$5')).cost, '$5');
  });
});
