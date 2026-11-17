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

// The clock in NJ: { date: 'YYYY-MM-DD', minutes: since midnight, text: '9:05 PM' }.
function nowNJ(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return { date: todayNJ(now), minutes: h * 60 + m, text: clockText(h * 60 + m) };
}

// 1265 -> '9:05 PM'. Minutes past midnight wrap (1500 -> '1:00 AM').
function clockText(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Whole days from a to b (b - a).
function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400e3);
}

module.exports = { todayNJ, addDays, weekday, thisWeekend, prettyDate, hourNJ, nowNJ, clockText, daysBetween };
