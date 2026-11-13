// Follow-ups: "I'll find out and text you back". Spec: research/FOLLOWUP-SPEC.md
//   The buddy offers after an honest miss on something checkable. On a yes it calls follow_up,
//   which lands here (create). Research writes a draft answer, Joe approves it, and
//   sendApproved texts it. One text per follow-up, and every follow-up ends with a text
//   (an answer or an honest "couldn't confirm it") unless it was closed or canceled first.
// Off unless FOLLOWUPS=on. The table comes from db/migrations/2026-11-12-followups.sql; if it
// isn't there yet, create() refuses, so the buddy never makes a promise it can't keep.
const { db, q } = require('./db');
const tickets = require('./tickets');
const { resolveTown } = require('./towns');
const { todayNJ, addDays, hourNJ, prettyDate } = require('./dates');

const MAX_OPEN = 2;                 // per person
const WAITING = ['open', 'drafted', 'approved', 'sending'];
const PROMISE = 'by tomorrow night';
const DUE_HOUR_NJ = 20;             // "tomorrow night" = 8pm NJ, an hour inside the 9pm cutoff
const MIN_DAYS_AHEAD = 2;           // needed_by must be at least this far out for the promise to be useful
const RECENT_SENT_HOURS = 72;       // how long a sent answer stays in the buddy's context
const KEEP_SENT_DAYS = 30;
const MAX_ANSWER = 750;             // same ceiling as a chat reply (lib/agent.js)
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MISSING = /followups.*(does not exist|schema cache)|PGRST205|42P01/i;

const enabled = () => process.env.FOLLOWUPS === 'on';
const mask = (p) => (p ? p.slice(0, -4).replace(/\d/g, '•') + p.slice(-4) : p);
const isMissing = (e) => MISSING.test(`${e?.code || ''} ${e?.message || e || ''}`);

// 8pm NJ on the day after `now`, as an ISO timestamp (works on either side of a clock change).
function dueAt(now = new Date()) {
  const day = addDays(todayNJ(now), 1);
  const guess = new Date(`${day}T${String(DUE_HOUR_NJ).padStart(2, '0')}:00:00Z`);
  const off = DUE_HOUR_NJ - hourNJ(guess);   // NJ is 4 or 5 hours behind UTC
  return new Date(guess.getTime() + off * 3600e3).toISOString();
}

/**
 * The buddy's follow_up tool. Always resolves; `ok: false` means "make no promise".
 * @param {{phone:string, channel?:string, question:string, needed_by?:string, town?:string, category?:string}} p
 * @returns {Promise<{ok:true, id:number, promise:string, say:string} | {ok:false, reason:string}>}
 */
async function create({ phone, channel = 'sms', question, needed_by, town, category }, now = new Date()) {
  const no = (reason) => ({ ok: false, reason: `${reason} Don't promise a text back; use the check-back wording instead.` });
  if (!enabled()) return no("Follow-ups aren't available right now.");
  const ask = tickets.scrub(question, 300);
  if (ask.length < 8) return no('That question is too thin to research.');
  const today = todayNJ(now);
  const needBy = YMD.test(String(needed_by || '')) ? needed_by : null;
  if (needBy && needBy < addDays(today, MIN_DAYS_AHEAD)) {
    return { ok: false, reason: "They need it sooner than you can find out (it takes about a day). Say that plainly, don't promise a text back, and give the closest real thing you have." };
  }
  try {
    const waiting = await q(db().from('followups').select('id').eq('phone', phone).in('status', WAITING));
    if (waiting.length >= MAX_OPEN) return no(`You're already looking into ${waiting.length} things for them; finish those first.`);
    const due = dueAt(now);
    const cat = tickets.CATEGORIES.includes(category) ? category : null;
    const ticket = await tickets.note({ kind: 'gap', summary: ask, details: `Follow-up promised ${PROMISE} (${prettyDate(addDays(today, 1))}).${needBy ? ` Needed by ${needBy}.` : ''}`, town, category: cat }, channel);
    const row = await q(db().from('followups').insert({
      phone, channel, question: ask, ticket_id: ticket.id || null,
      town_slug: town ? resolveTown(town) : null, category: cat,
      needed_by: needBy, due_at: due, agreed_at: now.toISOString(),
    }).select('id').single());
    return { ok: true, id: row.id, promise: PROMISE, say: `Tell them in one short line that you're on it and will text them ${PROMISE}. Use those words for the time; don't add another question.` };
  } catch (e) {
    if (isMissing(e)) console.warn('followups table not found; apply db/migrations/2026-11-12-followups.sql before setting FOLLOWUPS=on');
    else console.error('follow-up create', e.message);
    return no("Follow-ups aren't available right now.");
  }
}

/** The buddy's close_follow_up tool: it answered the question right in the conversation. */
async function close(phone, id) {
  try {
    const rows = await q(db().from('followups').update({ status: 'closed' })
      .eq('id', Number(id)).eq('phone', phone).in('status', ['open', 'drafted', 'approved']).select('id'));
    return { closed: rows.length > 0 };
  } catch (e) { if (!isMissing(e)) console.error('follow-up close', e.message); return { closed: false }; }
}

/**
 * What the buddy should know this turn: what it still owes them and what it recently sent.
 * @returns {Promise<{open:Array<{id:number,question:string,due_at:string}>, sent:Array<{question:string,answer_text:string,source_url:string|null,sent_at:string,found:boolean}>}>}
 */
async function forContext(phone, now = new Date()) {
  const none = { open: [], sent: [] };
  if (!enabled()) return none;
  try {
    const since = new Date(now.getTime() - RECENT_SENT_HOURS * 3600e3).toISOString();
    const [open, sent] = await Promise.all([
      q(db().from('followups').select('id,question,due_at').eq('phone', phone).in('status', WAITING).order('due_at')),
      q(db().from('followups').select('question,answer_text,source_url,sent_at,found').eq('phone', phone).eq('status', 'sent').gte('sent_at', since).order('sent_at', { ascending: false }).limit(3)),
    ]);
    return { open, sent };
  } catch (e) { if (!isMissing(e)) console.error('follow-up context', e.message); return none; }
}

// The lines added to the buddy's context (lib/agent.js describeProfile).
function describe(ctx, now = new Date()) {
  if (!ctx) return '';
  const today = todayNJ(now);
  const day = (iso) => { const d = todayNJ(new Date(iso)); return d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : d === addDays(today, -1) ? 'yesterday' : prettyDate(d); };
  const lines = [];
  for (const f of ctx.open || []) {
    lines.push(`- You promised to text them back about "${f.question}" by ${day(f.due_at)} night (follow-up id ${f.id}). Don't promise it again or offer it again; if they ask, you're still on it. If you fully answer it in this reply, call close_follow_up with that id.`);
  }
  for (const f of ctx.sent || []) {
    lines.push(`- ${day(f.sent_at) === 'today' ? 'Earlier today' : `On ${day(f.sent_at)}`} you texted them this follow-up to "${f.question}": "${f.answer_text}"${f.source_url ? ` (from ${f.source_url})` : ''}. ${f.found === false ? "You couldn't confirm it; don't claim more than that." : 'It was checked that day: answer questions about it from those words, and say so when a detail isn\'t in them.'}`);
  }
  if ((ctx.open || []).length >= MAX_OPEN) lines.push(`- That's ${MAX_OPEN} follow-ups open, the most one person can have: don't offer another.`);
  return lines.length ? `Follow-ups (texts you owe them or just sent):\n${lines.join('\n')}` : '';
}

/** STOP: nothing more gets sent, so nothing stays owed. */
async function cancelOpen(phone) {
  try { await q(db().from('followups').update({ status: 'canceled' }).eq('phone', phone).in('status', WAITING)); }
  catch (e) { if (!isMissing(e)) console.error('follow-up cancel', e.message); }
}

/** FORGET: their questions go with the rest of what we knew. Throws if the delete fails. */
async function forget(phone) {
  const { error } = await db().from('followups').delete().eq('phone', phone);
  if (error && !isMissing(error)) throw new Error(`db: ${error.message}`);
}

/** Nightly: drop sent, closed and canceled rows after KEEP_SENT_DAYS. */
async function prune(now = new Date()) {
  const before = new Date(now.getTime() - KEEP_SENT_DAYS * 86400e3).toISOString();
  try { await q(db().from('followups').delete().in('status', ['sent', 'closed', 'canceled']).lte('created_at', before)); }
  catch (e) { if (!isMissing(e)) console.error('follow-up prune', e.message); }
}

// ---------- research and approval (scripts/followups.js) ----------

// What research sees: the question, never who asked.
const RESEARCH_COLS = 'id,status,question,town_slug,category,needed_by,due_at,found,answer_text,source_url,created_at,channel';

async function list({ status, includeTest = false } = {}) {
  let query = db().from('followups').select(RESEARCH_COLS).order('due_at');
  query = status ? query.eq('status', status) : query.in('status', WAITING);
  const rows = await q(query);
  return includeTest ? rows : rows.filter((r) => r.channel !== 'test');
}

/** Save a draft answer. `found: false` is the honest close ("couldn't confirm it"). */
async function draft(id, { answer, source, found = true }) {
  const text = String(answer || '').replace(/[ \t]+/g, ' ').trim();
  if (!text) throw new Error('answer is required');
  if (text.length > MAX_ANSWER) throw new Error(`answer is ${text.length} characters; the limit is ${MAX_ANSWER} (aim for under 450)`);
  if (/[*_#`]|\]\(/.test(text)) throw new Error('answer must be plain text: no markdown');
  if (found && !/^https?:\/\/\S+$/.test(String(source || ''))) throw new Error('an answer needs --source with the page it came from (the venue or organizer\'s own page, or the ticket page)');
  const rows = await q(db().from('followups').update({ status: 'drafted', answer_text: text, source_url: source || null, found: Boolean(found) })
    .eq('id', Number(id)).in('status', ['open', 'drafted']).select(RESEARCH_COLS));
  if (!rows.length) throw new Error(`follow-up ${id} isn't open or drafted`);
  return rows[0];
}

async function approve(id) {
  const rows = await q(db().from('followups').update({ status: 'approved' }).eq('id', Number(id)).eq('status', 'drafted').select(RESEARCH_COLS));
  if (!rows.length) throw new Error(`follow-up ${id} has no draft to approve`);
  return rows[0];
}

/** Send a draft back to research. The promise still stands, so it returns to open. */
async function reject(id) {
  const rows = await q(db().from('followups').update({ status: 'open', answer_text: null, source_url: null, found: null })
    .eq('id', Number(id)).in('status', ['drafted', 'approved']).select(RESEARCH_COLS));
  if (!rows.length) throw new Error(`follow-up ${id} isn't drafted or approved`);
  return rows[0];
}

/**
 * Text every approved follow-up (or just one). Dry run unless dryRun === false.
 * Each row is claimed (approved -> sending) before its text goes out, so two runs can't both send it.
 * @param {{id?:number, dryRun?:boolean, send?:(to:string, body:string)=>Promise<any>, now?:Date}} p
 */
async function sendApproved({ id, dryRun = true, send, now = new Date() } = {}) {
  let query = db().from('followups').select('id,phone,channel,question,answer_text,due_at').eq('status', 'approved').order('due_at');
  if (id != null) query = query.eq('id', Number(id));
  const ready = await q(query);
  const preview = ready.map((r) => ({ id: r.id, to: mask(r.phone), chars: r.answer_text.length, message: r.answer_text, late: r.due_at < now.toISOString() }));
  if (dryRun) return { ok: true, dry_run: true, ready: preview };

  const hour = hourNJ(now);
  if (hour < 8 || hour >= 21) return { ok: false, error: `Quiet hours: it's ${hour}:00 in NJ. Texts go out 8am-9pm only.`, ready: preview };
  if (!send) send = require('./twilio').sendSms;

  let sent = 0;
  const skipped = [];
  const failed = [];
  for (const r of ready) {
    if (r.channel === 'test') { skipped.push({ id: r.id, why: 'test row' }); continue; }
    const user = await q(db().from('sms_users').select('opted_out').eq('phone', r.phone).maybeSingle());
    if (!user || user.opted_out) {
      await q(db().from('followups').update({ status: 'canceled' }).eq('id', r.id));
      skipped.push({ id: r.id, why: 'opted out' });
      continue;
    }
    const claimed = await q(db().from('followups').update({ status: 'sending' }).eq('id', r.id).eq('status', 'approved').select('id'));
    if (!claimed.length) { skipped.push({ id: r.id, why: 'already being sent' }); continue; }
    try {
      await send(r.phone, r.answer_text);
    } catch (e) {
      await q(db().from('followups').update({ status: 'approved' }).eq('id', r.id).eq('status', 'sending'));
      failed.push({ id: r.id, to: mask(r.phone), error: e.message });
      continue;
    }
    // The text is out: record that first, so a failure below can never cause a second send.
    await q(db().from('followups').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id));
    await q(db().from('sms_messages').insert({ phone: r.phone, direction: 'out', body: r.answer_text })).catch((e) => console.error('follow-up log', e.message));
    sent++;
  }
  return { ok: true, sent, skipped, failed };
}

module.exports = {
  enabled, create, close, forContext, describe, cancelOpen, forget, prune,
  list, draft, approve, reject, sendApproved, dueAt,
  MAX_OPEN, PROMISE, WAITING,
};
