// Offline test for the article pipeline. It runs the REAL code in lib/ and api/ (discovery,
// verification, writer, review, both endpoints) with the database, Claude and the web replaced
// by in-memory fakes. No network, no keys, nothing written anywhere.
//   node scripts/test-article-pipeline.js
//
// The fake database enforces the check constraints it reads from db/migrations/*.sql, so code
// that writes a value the real tables would reject fails here too.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { BY_SLUG } = require('../lib/towns');
const { MOCK_RSS_FEED, MOCK_VENUES, MOCK_SEARCH_RESULTS } = require('../lib/fixtures');

// ---------- constraints, read from the migrations ----------
const CHECKS = {}; // table -> column -> allowed values
const setCheck = (table, col, list) => ((CHECKS[table] ||= {})[col] = list.split(',').map((v) => v.trim().replace(/^'|'$/g, '')));
for (const file of ['2026-11-15-article-pipeline.sql', '2026-11-15b-article-pipeline-fixes.sql']) {
  const sql = fs.readFileSync(path.join(ROOT, 'db/migrations', file), 'utf8');
  for (const [, table, body] of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const [, col, list] of body.matchAll(/check \((\w+) in \(([^)]*)\)\)/g)) setCheck(table, col, list);
  }
  for (const [, table, col, list] of sql.matchAll(/alter table (\w+) add constraint \w+\s+check \((\w+) in \(([^)]*)\)\)/g)) setCheck(table, col, list);
}
assert(CHECKS.verified_entities.entity_type.includes('restaurant'), 'migrations were parsed');

const TOWN_REQUIRED = new Set(['article_drafts', 'published_articles']);
function violation(table, row, others) {
  for (const [col, allowed] of Object.entries(CHECKS[table] || {})) {
    if (row[col] != null && !allowed.includes(row[col])) return `new row for relation "${table}" violates check constraint "${table}_${col}_check" (${col}=${row[col]})`;
  }
  if ('town_slug' in row || TOWN_REQUIRED.has(table)) {
    if (row.town_slug == null && TOWN_REQUIRED.has(table)) return `null value in column "town_slug" of relation "${table}"`;
    if (row.town_slug != null && !BY_SLUG.has(row.town_slug)) return `insert or update on table "${table}" violates foreign key constraint (town_slug=${row.town_slug})`;
  }
  if (table === 'published_articles' && others.some((r) => r !== row && r.draft_id === row.draft_id)) return 'duplicate key value violates unique constraint "published_articles_draft_uidx"';
  return null;
}

// ---------- a tiny in-memory stand-in for the Supabase client (same shape as test-followups.js) ----------
const T = {};
let seq = 0;
const stamp = () => new Date(Date.now() + ++seq).toISOString();
const DEFAULTS = {
  discovery_sources: () => ({ enabled: true }),
  article_drafts: () => ({ status: 'pending', unconfirmed_items: [] }),
  article_pipeline_runs: () => ({ status: 'running' }),
};
const failNext = {}; // table -> error message for the next insert (to simulate an outage)

function from(table) {
  const rows = () => (T[table] ||= []);
  const s = { op: 'select', filters: [], payload: null, returning: false, one: false, limit: null, orders: [], cols: null };
  const pick = (r) => (s.cols ? Object.fromEntries(s.cols.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r });
  const hit = (r) => s.filters.every((f) => f(r));
  const add = (f) => { s.filters.push(f); return b; };
  const fail = (message) => ({ data: null, error: { message } });
  const run = () => {
    if (s.op === 'insert') {
      if (failNext[table]) { const message = failNext[table]; delete failNext[table]; return fail(message); }
      const made = s.payload.map((p) => ({ id: ++seq, created_at: stamp(), ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...JSON.parse(JSON.stringify(p)) }));
      for (const row of made) { const bad = violation(table, row, rows()); if (bad) return fail(bad); }
      rows().push(...made);
      return { data: s.returning ? (s.one ? pick(made[0]) : made.map(pick)) : null, error: null };
    }
    if (s.op === 'update') {
      const m = rows().filter(hit);
      for (const r of m) { const bad = violation(table, { ...r, ...s.payload }, rows().filter((x) => x !== r)); if (bad) return fail(bad); }
      m.forEach((r) => Object.assign(r, s.payload));
      return { data: s.returning ? m.map(pick) : null, error: null };
    }
    let out = rows().filter(hit);
    for (const [c, asc] of s.orders) out = [...out].sort((x, y) => (x[c] > y[c] ? 1 : x[c] < y[c] ? -1 : 0) * (asc ? 1 : -1));
    if (s.limit != null) out = out.slice(0, s.limit);
    if (s.one) return { data: out[0] ? pick(out[0]) : null, error: null };
    return { data: out.map(pick), error: null };
  };
  const b = {
    select(cols) { if (s.op !== 'select') s.returning = true; if (cols && cols !== '*') s.cols = cols.split(',').map((c) => c.trim()); return b; },
    insert(p) { s.op = 'insert'; s.payload = Array.isArray(p) ? p : [p]; return b; },
    update(p) { s.op = 'update'; s.payload = p; return b; },
    eq: (c, v) => add((r) => r[c] === v),
    in: (c, vs) => add((r) => vs.includes(r[c])),
    order(c, o = {}) { s.orders.push([c, o.ascending !== false]); return b; },
    limit(n) { s.limit = n; return b; },
    maybeSingle() { s.one = true; return b; },
    single() { s.one = true; return b; },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}

const fakeModule = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
fakeModule(require.resolve(path.join(ROOT, 'lib/db.js')), { db: () => ({ from }), q: async (p) => { const { data, error } = await p; if (error) throw new Error(`db: ${error.message}`); return data; } });

// ---------- fake Claude: scripted replies, keyed on what the prompt is about ----------
const ENTITIES = {
  'Blue Moon Trattoria Opens': [{ name: 'Blue Moon Trattoria', type: 'restaurant', town: 'Ridgewood' }],
  'Hackensack Brewery': [{ name: 'Ironbound Brewing Company', type: 'brewery', town: 'Hackensack, NJ' }],
  'Garden State Plaza': [{ name: 'Garden State Plaza', type: 'mall', town: 'Paramus' }], // 'mall' is not an allowed type
  'Zed Books': [{ name: 'Zed Books', type: 'shop', town: 'Ridgewood' }],
  'Fort Lee Opens': [],
};
// A hostile writer reply: tries to raise confidence, invent a town and a link, and inject markup.
const HOSTILE_DRAFT = {
  headline: 'Blue Moon Trattoria Opens in Ridgewood',
  body: 'Blue Moon Trattoria opened on East Ridgewood Avenue this week. Hours are not posted yet.',
  category: 'breaking-news',
  town_slug: 'narnia',
  entity_link: 'javascript:alert(1)',
  confidence: 'high',
  unconfirmed_items: ['hours', '<img src=x onerror=alert(1)>', 42],
};
let failNextModelCall = false;
class FakeAnthropic {
  constructor() {
    this.messages = {
      create: async (params) => {
        if (failNextModelCall) { failNextModelCall = false; throw new Error('529 overloaded'); }
        const prompt = params.messages[0].content;
        let text;
        if (prompt.startsWith('Extract business')) {
          const key = Object.keys(ENTITIES).find((k) => prompt.includes(k));
          text = '```json\n' + JSON.stringify(key ? ENTITIES[key] : []) + '\n```';
        } else if (prompt.includes('Blue Moon')) {
          text = JSON.stringify(HOSTILE_DRAFT);
        } else {
          text = 'Here is the draft:\n' + JSON.stringify({ headline: 'Ironbound Brewing Opens in Hackensack', body: 'Ironbound Brewing Company holds its grand opening November 20 at 123 Main Street.', category: 'food', town_slug: 'hackensack', confidence: 'high', unconfirmed_items: [] });
        }
        return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] };
      },
    };
  }
}
fakeModule(require.resolve('@anthropic-ai/sdk'), FakeAnthropic);

// ---------- fake web: one feed, and DuckDuckGo result pages built from the fixtures ----------
const EXTRA_ITEMS = `
    <item>
      <title><![CDATA[Zed Books Opens in Ridgewood &#8211; A New Shop]]></title>
      <link>https://example.com/news/zed-books?utm_source=rss&amp;utm_medium=feed</link>
      <description><![CDATA[<p>A new bookshop, Zed Books, opened in Ridgewood.</p>]]></description>
      <pubDate>sometime last week</pubDate>
    </item>`;
const FEED = MOCK_RSS_FEED.replace('</channel>', `${EXTRA_ITEMS}\n  </channel>`);
const SEARCH = {
  ...MOCK_SEARCH_RESULTS,
  'garden state plaza': [
    { url: 'https://example.com/news/gsp-holiday-hours', title: 'Original news article' },
    { url: 'https://www.gardenstateplaza.com/hours', title: 'Garden State Plaza hours' },
    { url: 'https://www.facebook.com/gardenstateplaza', title: 'Garden State Plaza on Facebook' },
  ],
  'zed books': [
    { url: 'https://en.wikipedia.org/wiki/Bookselling', title: 'Bookselling - Wikipedia' },
    { url: 'https://www.wix.com/blog/how-to-open-a-bookstore', title: 'How to open a bookstore' },
  ],
};
const ddgPage = (results) => `<html><body>${results.map((r) => `<div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}&amp;rut=abc">${r.title}</a></h2></div>`).join('')}</body></html>`;
const fetched = [];
global.fetch = async (url) => {
  fetched.push(String(url));
  const u = new URL(url);
  if (u.hostname === 'feeds.test') return { ok: true, status: 200, headers: { get: () => 'application/rss+xml' }, text: async () => FEED };
  if (u.hostname === 'html.duckduckgo.com') {
    const query = u.searchParams.get('q').toLowerCase();
    const key = Object.keys(SEARCH).find((k) => query.includes(k.split(' ').slice(0, 2).join(' ')));
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => ddgPage(key ? SEARCH[key] : []) };
  }
  throw new Error(`unexpected fetch in an offline test: ${url}`);
};
delete process.env.FIRECRAWL_API_KEY;
process.env.ADMIN_TOKEN = 'admin-token-for-test';
process.env.CRON_SECRET = 'cron-secret-for-test';

// ---------- the real code ----------
const discovery = require('../lib/discovery');
const verification = require('../lib/verification');
const articles = require('../lib/articles');
const pipelineApi = require('../api/article-pipeline');
const reviewApi = require('../api/article-review');

// Call a Vercel-style handler and collect what it answered.
async function call(handler, { method = 'GET', url = '/', token, body } = {}) {
  const out = { status: 0, json: null };
  const res = { setHeader() {}, status(c) { out.status = c; return res; }, json(j) { out.json = j; return res; }, end() { return res; } };
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
  await handler({ method, url, headers, body: body ?? (method === 'POST' ? {} : undefined) }, res);
  return out;
}

const storyTitled = (part) => T.discovered_stories.find((s) => s.title.includes(part));
const draftsFor = (story) => (T.article_drafts || []).filter((d) => d.story_id === story.id);
const quiet = async (fn) => { const { log, error } = console; console.log = console.error = () => {}; try { return await fn(); } finally { console.log = log; console.error = error; } };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('feed parsing: entities decoded, HTML stripped, bad dates do not throw', () => {
  const stories = discovery.parseRssFeed(FEED);
  assert.strictEqual(stories.length, 5);
  const zed = stories.find((s) => s.title.startsWith('Zed Books'));
  assert.strictEqual(zed.title, 'Zed Books Opens in Ridgewood – A New Shop');
  assert.strictEqual(zed.summary, 'A new bookshop, Zed Books, opened in Ridgewood.');
  assert.strictEqual(zed.url, 'https://example.com/news/zed-books?utm_source=rss&utm_medium=feed');
  assert.strictEqual(zed.publishedAt, null, 'an unreadable pubDate becomes null, not an Invalid Date');
});

test('second source: must be another site that names the business', () => {
  const results = [
    { url: 'https://example.com/news/blue-moon-opens-ridgewood', title: 'Blue Moon Trattoria opens' },   // the story itself
    { url: 'https://bluemoontrattoria.com/menu', title: 'Blue Moon Trattoria menu' },                     // the business's own site
    { url: 'https://x.com/bluemoontrattoria', title: 'Blue Moon Trattoria' },                             // social
    { url: 'https://www.wix.com/blog/restaurants', title: 'Restaurant websites' },                        // unrelated
    { url: 'https://www.yelp.com/biz/blue-moon-trattoria-ridgewood', title: '' },                         // names it in the URL
  ];
  const website = verification.extractBusinessWebsite(results, 'Blue Moon Trattoria');
  assert.strictEqual(website, 'https://bluemoontrattoria.com/menu');
  const args = { storyUrl: 'https://example.com/news/blue-moon-opens-ridgewood', website, businessName: 'Blue Moon Trattoria' };
  assert.strictEqual(verification.findSecondSource(results, args), 'https://www.yelp.com/biz/blue-moon-trattoria-ridgewood');
  assert.strictEqual(verification.findSecondSource(results.slice(0, 4), args), null, 'story, own site, social and unrelated pages are not second sources');
  assert.strictEqual(verification.extractBusinessWebsite(results.slice(3, 4), 'Blue Moon Trattoria'), null, 'no guessing a website from an unrelated hit');
});

test('pipeline endpoint: Vercel cron (GET + CRON_SECRET) and manual POST are both accepted', async () => {
  assert.strictEqual((await call(pipelineApi, { method: 'GET', url: '/api/article-pipeline' })).status, 401);
  assert.strictEqual((await call(pipelineApi, { method: 'GET', url: '/api/article-pipeline', token: 'wrong' })).status, 401);
  assert.strictEqual((await call(pipelineApi, { method: 'PUT', url: '/api/article-pipeline', token: process.env.ADMIN_TOKEN })).status, 405);
  assert.strictEqual((await call(pipelineApi, { method: 'POST', url: '/api/article-pipeline', token: process.env.ADMIN_TOKEN, body: { steps: ['nonsense'] } })).status, 400);

  T.discovery_sources = [{ id: ++seq, name: 'Test feed', url: 'https://feeds.test/rss', source_type: 'rss', enabled: true }];
  T.venues = MOCK_VENUES.map((v) => ({ ...v }));

  const dry = await quiet(() => call(pipelineApi, { method: 'POST', url: '/api/article-pipeline?dry_run=1', token: process.env.ADMIN_TOKEN }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  assert.strictEqual(dry.json.dryRun, true);
  assert.strictEqual((T.discovered_stories || []).length, 0, 'a dry run writes nothing');

  const run = await quiet(() => call(pipelineApi, { method: 'GET', url: '/api/article-pipeline', token: process.env.CRON_SECRET }));
  assert.strictEqual(run.status, 200, JSON.stringify(run.json));
  assert.strictEqual(run.json.success, true, run.json.error);
  assert.strictEqual(run.json.steps.discovery.storiesNew, 5);
  assert.strictEqual(run.json.steps.verification.errors, 0);
  assert.strictEqual(run.json.steps.writing.errors, 0);
  assert.strictEqual(T.article_pipeline_runs.at(-1).status, 'completed');
});

test('verification: types, towns, venue matches and second sources', () => {
  const [blue] = T.verified_entities.filter((e) => e.name === 'Blue Moon Trattoria');
  assert.strictEqual(blue.entity_type, 'restaurant', 'the extractor\'s types are storable');
  assert.strictEqual(blue.town_slug, 'ridgewood', 'town is resolved (resolveTown returns the slug)');
  assert.strictEqual(blue.confidence, 'medium');
  assert.strictEqual(blue.website, 'https://bluemoontrattoria.com');
  assert.strictEqual(blue.second_source_url, 'https://yelp.com/biz/blue-moon-trattoria-ridgewood');

  const [iron] = T.verified_entities.filter((e) => e.name === 'Ironbound Brewing Company');
  assert.strictEqual(iron.confidence, 'high', 'matched the venue we already list');
  assert.strictEqual(iron.venue_id, MOCK_VENUES[0].id);
  assert.notStrictEqual(iron.second_source_url, storyTitled('Hackensack Brewery').url, 'the story is never its own second source');
  assert.strictEqual(iron.second_source_url, 'https://northjersey.com/story/food/beer/2026/11/13/ironbound-brewing-hackensack');

  const [gsp] = T.verified_entities.filter((e) => e.name === 'Garden State Plaza');
  assert.strictEqual(gsp.entity_type, 'other', 'an unknown type is stored as other, not rejected by the table');
  assert.strictEqual(gsp.confidence, 'low');
  assert.strictEqual(gsp.second_source_url, null, 'its own site and its Facebook page do not confirm it');

  assert(!T.verified_entities.some((e) => e.name === 'Zed Books'), 'unrelated search hits verify nothing');
  assert.strictEqual(storyTitled('Zed Books').status, 'rejected');
  assert.strictEqual(storyTitled('Fort Lee').status, 'rejected');
});

test('writer: drafts only with a second source; model output cannot override verification', () => {
  const [draft] = draftsFor(storyTitled('Blue Moon'));
  assert.strictEqual(draft.status, 'pending');
  assert.strictEqual(draft.town_slug, 'ridgewood', 'an invented town falls back to the verified one');
  assert.strictEqual(draft.category, 'other', 'an unknown category falls back to other');
  assert.strictEqual(draft.confidence, 'medium', 'the model cannot raise confidence above verification');
  assert.strictEqual(draft.entity_link, 'https://bluemoontrattoria.com', 'the link comes from verification, not the model');
  assert.deepStrictEqual(draft.unconfirmed_items, ['hours', '<img src=x onerror=alert(1)>'], 'non-strings dropped (markup is escaped at render time)');

  const [iron] = draftsFor(storyTitled('Hackensack Brewery'));
  assert.strictEqual(iron.status, 'pending');
  assert.strictEqual(iron.confidence, 'high');

  const gsp = draftsFor(storyTitled('Garden State Plaza'));
  assert.strictEqual(gsp.length, 1);
  assert.strictEqual(gsp[0].status, 'needs_manual_check');
  assert.strictEqual(storyTitled('Garden State Plaza').status, 'needs_manual_check');
});

test('a second run adds nothing: no duplicate stories, no repeat placeholder drafts', async () => {
  const before = { stories: T.discovered_stories.length, drafts: T.article_drafts.length, entities: T.verified_entities.length };
  const run = await quiet(() => call(pipelineApi, { method: 'GET', url: '/api/article-pipeline', token: process.env.CRON_SECRET }));
  assert.strictEqual(run.json.success, true, run.json.error);
  assert.strictEqual(run.json.steps.discovery.storiesDuplicate, 5);
  assert.deepStrictEqual({ stories: T.discovered_stories.length, drafts: T.article_drafts.length, entities: T.verified_entities.length }, before);
});

test('one failing story does not stop the run', async () => {
  T.discovered_stories.push({ id: ++seq, created_at: stamp(), source_id: 1, url: 'https://example.com/news/boom', title: 'Boom in Ridgewood', summary: null, dedup_hash: 'boom', status: 'new' });
  T.discovered_stories.push({ id: ++seq, created_at: stamp(), source_id: 1, url: 'https://example.com/news/fort-lee-2', title: 'Fort Lee Opens Another Park', summary: null, dedup_hash: 'fl2', status: 'new' });
  // The first story's model call fails (rate limit, outage...); the second must still be processed.
  failNextModelCall = true;
  const result = await quiet(() => verification.runVerification({ limit: 50 }));
  assert.strictEqual(result.errors, 1);
  assert.strictEqual(result.storiesProcessed, 1);
  assert.strictEqual(storyTitled('Boom').status, 'processing', 'left for the next run');
  assert.strictEqual(storyTitled('Another Park').status, 'rejected');
});

test('review API: lists both queues; approve publishes exactly once', async () => {
  const list = await call(reviewApi, { method: 'GET', url: '/api/article-review', token: process.env.ADMIN_TOKEN });
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.pending.length, 2);
  assert.strictEqual(list.json.needsCheck.length, 1, 'stories that need a manual check are visible to Joe');
  assert.strictEqual((await call(reviewApi, { method: 'GET', url: '/api/article-review' })).status, 401);

  const [blue] = draftsFor(storyTitled('Blue Moon'));
  const post = (body) => quiet(() => call(reviewApi, { method: 'POST', url: '/api/article-review', token: process.env.ADMIN_TOKEN, body }));

  // If publishing fails, the draft goes back to pending instead of being stuck 'approved'.
  failNext.published_articles = 'connection reset';
  assert.strictEqual((await post({ action: 'approve', draft_id: blue.id })).status, 500);
  assert.strictEqual(draftsFor(storyTitled('Blue Moon'))[0].status, 'pending');

  // Two approvals at once (double click): one wins, one gets 409, one article is published.
  const both = await Promise.all([post({ action: 'approve', draft_id: blue.id }), post({ action: 'approve', draft_id: blue.id })]);
  assert.deepStrictEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.strictEqual(T.published_articles.filter((a) => a.draft_id === blue.id).length, 1);
  assert.strictEqual(draftsFor(storyTitled('Blue Moon'))[0].status, 'published');

  // A published draft cannot be rejected out from under its article.
  assert.strictEqual((await post({ action: 'reject', draft_id: blue.id, reason: 'oops' })).status, 409);
  assert.strictEqual(draftsFor(storyTitled('Blue Moon'))[0].status, 'published');

  // A needs-check placeholder can be dismissed, and never approved.
  const [gsp] = draftsFor(storyTitled('Garden State Plaza'));
  assert.strictEqual((await post({ action: 'approve', draft_id: gsp.id })).status, 409);
  assert.strictEqual((await post({ action: 'reject', draft_id: gsp.id, reason: 'not a weekend pick' })).status, 200);
  assert.strictEqual(draftsFor(storyTitled('Garden State Plaza'))[0].status, 'rejected');
  assert.strictEqual((await post({ action: 'reject', draft_id: 999999 })).status, 409, 'unknown draft');
});

test('review page: feed and model text cannot inject markup or script links', () => {
  const html = fs.readFileSync(path.join(ROOT, 'article-review.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const el = () => ({ classList: { add() {}, remove() {} }, style: {}, textContent: '', innerHTML: '', value: '', querySelectorAll: () => [] });
  const context = vm.createContext({ document: { getElementById: el }, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ ok: false, status: 401 }), console, setTimeout, location: {}, alert() {}, confirm: () => false, prompt: () => null });
  vm.runInContext(script, context);
  const attack = {
    id: 7, created_at: new Date().toISOString(), town_slug: 'ridgewood', category: 'food',
    headline: '<script>alert(1)</script>', body: '<b>bold</b>',
    confidence: '"><img src=x onerror=alert(1)>',
    unconfirmed_items: ['<img src=x onerror=alert(1)>'],
    source_url: 'https://example.com/a" onmouseover="alert(1)',
    entity_link: 'javascript:alert(1)',
    second_source_url: 'data:text/html,<script>alert(1)</script>',
  };
  for (const render of ['renderDraft', 'renderNeedsCheck']) {
    const out = vm.runInContext(`${render}(${JSON.stringify(attack)})`, context);
    assert(!/<img|<script|<b>/i.test(out), `${render}: no raw markup from draft fields`);
    assert(!/href="(javascript|data):/i.test(out), `${render}: no script links`);
    assert(!/" onmouseover="/.test(out), `${render}: quotes cannot break out of an attribute`);
    assert(/href="#"/.test(out), `${render}: non-http links are neutralised`);
  }
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (error) { failed++; console.log(`FAIL ${name}\n     ${String(error.stack || error).split('\n').slice(0, 6).join('\n     ')}`); }
  }
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
