// Dates in New Jersey time, as YYYY-MM-DD strings.
const TZ = 'America/New_York';

function todayNJ(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(ymd) {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday
}

// Fri-Sun of this weekend. On Fri/Sat/Sun it's the current one, Mon-Thu the next one.
function thisWeekend(now = new Date()) {
  const today = todayNJ(now);
  const dow = weekday(today);
  if (dow === 0) return { start: today, end: today };
  if (dow === 6) return { start: today, end: addDays(today, 1) };
  const friday = addDays(today, (5 - dow + 7) % 7);
  return { start: friday, end: addDays(friday, 2) };
}

function prettyDate(ymd) {
  if (!ymd) return 'date TBA';
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

// Hour of day in NJ (0-23), for quiet hours on text blasts.
function hourNJ(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

module.exports = { todayNJ, addDays, weekday, thisWeekend, prettyDate, hourNJ };
