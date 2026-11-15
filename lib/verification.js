// Verification: confirm businesses/venues are real, resolve links and towns.
const Anthropic = require('@anthropic-ai/sdk');
const { db, q } = require('./db');
const { resolveTown } = require('./towns');

const MODEL = 'claude-haiku-5-5';
const EFFORT = 'low';

// Must match the entity_type check on verified_entities (see db/migrations).
const ENTITY_TYPES = ['restaurant', 'cafe', 'bar', 'brewery', 'shop', 'store', 'venue', 'gym', 'studio', 'event', 'business', 'place', 'other'];
const entityType = (t) => (ENTITY_TYPES.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : 'other');

// Sites that list a business but are not the business's own site.
const LISTING_HOSTS = ['yelp.com', 'tripadvisor.com', 'opentable.com', 'google.com'];
// Never a source: anyone can post anything.
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com'];

let client;
const anthropic = () => (client ||= new Anthropic());

// 'https://www.Yelp.com/biz/x' -> 'yelp.com'; null when it is not an http(s) URL.
function hostOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
const hostIn = (host, list) => !!host && list.some((h) => host === h || host.endsWith(`.${h}`));

// "The Blue Moon Trattoria!" -> "bluemoontrattoria", for loose name matching.
const nameKey = (s) => String(s || '').toLowerCase().replace(/^\s*the\s+/, '').replace(/[^a-z0-9]/g, '');

// Keys to look for in a page: the full name, and the name without a trailing "Company", "LLC"...
// ("Ironbound Brewing Company" is "Ironbound Brewing" in headlines and in its own domain.)
const GENERIC_TAIL = /(\s+(company|co|inc|llc|corp|restaurant))+\.?\s*$/i;
function nameKeys(name) {
  const full = nameKey(name);
  const short = nameKey(String(name || '').replace(GENERIC_TAIL, ''));
  return [...new Set([full, short])].filter((k) => k.length >= 5);
}

// Pull the first JSON value out of a model reply (it may be wrapped in a code fence or prose).
function parseJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/[[{][\s\S]*[\]}]/);
    if (!m) throw new Error('no JSON in model reply');
    return JSON.parse(m[0]);
  }
}

// Extract business/venue mentions using Claude (more accurate than regex).
// API errors are thrown, not swallowed: a bad key or model must not look like "no businesses found".
async function extractEntities(story) {
  const text = `Title: ${story.title}\n\nSummary: ${story.summary || 'N/A'}`;

  const prompt = `Extract business or venue names mentioned in this news story. Only include actual business names (restaurants, cafes, bars, shops, venues, etc.), not general references.

${text}

For each business, provide:
- name: The exact business name
- type: ${ENTITY_TYPES.join(' | ')}
- town: Bergen County town if mentioned (or null)
- context: One sentence explaining why you extracted it

Return JSON array only, no other text. If no businesses are mentioned, return empty array.

Example: [{"name": "Blue Moon Cafe", "type": "cafe", "town": "Ridgewood", "context": "Article announces this new cafe is opening"}]`;

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000, // thinking is on by default and counts against this; 500 cut replies short
    system: 'You extract structured data from text. Return only valid JSON, no other text.',
    output_config: { effort: EFFORT },
    messages: [{ role: 'user', content: prompt }]
  });

  if (response.stop_reason === 'refusal') return [];

  const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('') || '[]';
  let entities;
  try {
    entities = parseJson(reply);
  } catch (error) {
    console.error('Entity extraction: unreadable reply:', error.message);
    return [];
  }

  return (Array.isArray(entities) ? entities : [])
    .filter(e => e && typeof e.name === 'string' && e.name.trim())
    .map(e => ({ ...e, name: e.name.trim(), type: entityType(e.type) }));
}

// Search for existing venue in database
async function findExistingVenue(entityName, townSlug) {
  const key = nameKey(entityName);
  if (key.length < 3) return null;

  let query = db().from('venues').select('id,name,town_slug,address,website,category').eq('status', 'open');

  if (townSlug) {
    query = query.eq('town_slug', townSlug);
  }

  const venues = await q(query);

  // Exact match first; otherwise one name may contain the other, but only when the shorter
  // one is long enough to mean something ("Park" must not match "Park West Tavern").
  const exact = venues.find(v => nameKey(v.name) === key);
  if (exact) return exact;

  return venues.find(v => {
    const vk = nameKey(v.name);
    const shorter = vk.length < key.length ? vk : key;
    return shorter.length >= 8 && (vk.includes(key) || key.includes(vk));
  }) || null;
}

const searchQueryFor = (businessName, town) =>
  town ? `${businessName} ${town} New Jersey` : `${businessName} Bergen County New Jersey`;

// Search for business info using Firecrawl, falling back to DuckDuckGo.
// Returns [{ url, title, description }].
async function searchBusiness(businessName, town) {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;

  if (!firecrawlKey) {
    return searchWithBasicFetch(businessName, town);
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlKey}`
      },
      body: JSON.stringify({
        query: searchQueryFor(businessName, town),
        limit: 5
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Firecrawl search failed: ${response.status}`);
    }

    const data = await response.json();
    return (data.data || []).map(r => ({
      url: r.url || r.link || '',
      title: r.title || '',
      description: r.description || r.snippet || ''
    }));
  } catch (error) {
    console.error('Firecrawl search error:', error.message);
    return searchWithBasicFetch(businessName, town);
  }
}

const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Parse DuckDuckGo's HTML results page into [{ url, title, description }].
function parseDuckDuckGo(html) {
  const results = [];
  const linkPattern = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html)) !== null && results.length < 5) {
    const href = match[0].match(/href="([^"]+)"/i);
    const target = href && href[1].match(/uddg=([^&"]+)/);
    if (!target) continue;
    try {
      const url = decodeURIComponent(target[1].replace(/&amp;.*$/, ''));
      if (hostOf(url) && !hostIn(hostOf(url), ['duckduckgo.com'])) {
        results.push({ url, title: stripTags(match[1]), description: '' });
      }
    } catch (e) {
      // Skip malformed URLs
    }
  }

  return results;
}

// Fallback: DuckDuckGo HTML search (no API key needed)
async function searchWithBasicFetch(businessName, town) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQueryFor(businessName, town))}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Exit163Bot/1.0' },
      signal: AbortSignal.timeout(10000)
    });

    // DuckDuckGo answers 202 with a challenge page (no results) when it takes us for a bot.
    if (response.status !== 200) {
      console.error(`Basic search: DuckDuckGo answered ${response.status}, no results. Set FIRECRAWL_API_KEY for real search.`);
      return [];
    }

    return parseDuckDuckGo(await response.text());
  } catch (error) {
    console.error('Basic search error:', error.message);
    return [];
  }
}

// Does this search result actually talk about the business? (title, snippet or URL slug)
function mentionsBusiness(result, businessName) {
  const page = nameKey(`${result.title || ''} ${result.description || ''} ${result.url || ''}`);
  return nameKeys(businessName).some((key) => page.includes(key));
}

// Extract the business's own site, or failing that a listing page for it.
// Returns null rather than guessing: an unrelated first hit is not the business's link.
function extractBusinessWebsite(searchResults, businessName) {
  const keys = nameKeys(businessName);
  if (keys.length === 0) return null;

  // Own site: the name is in the domain itself (bluemoontrattoria.com).
  for (const result of searchResults) {
    const host = hostOf(result.url);
    if (!host || hostIn(host, SOCIAL_HOSTS) || hostIn(host, LISTING_HOSTS)) continue;
    const domain = nameKey(host.split('.').slice(0, -1).join(''));
    if (keys.some((key) => domain.includes(key))) return result.url;
  }

  // Otherwise a listing page that names the business.
  for (const result of searchResults) {
    if (hostIn(hostOf(result.url), LISTING_HOSTS) && mentionsBusiness(result, businessName)) return result.url;
  }

  return null;
}

// Find a second source: a page on a different site from the original story and from the
// business's own link, that names the business. Social media never counts.
function findSecondSource(searchResults, { storyUrl, website, businessName }) {
  const storyHost = hostOf(storyUrl);
  const websiteHost = hostOf(website);

  for (const result of searchResults) {
    const host = hostOf(result.url);
    if (!host) continue;
    if (host === storyHost || host === websiteHost) continue;
    if (hostIn(host, SOCIAL_HOSTS)) continue;
    if (!mentionsBusiness(result, businessName)) continue;
    return result.url;
  }

  return null;
}

// Attempt to verify an entity using the venues table and web search
async function verifyEntity(entity, storyUrl) {
  // resolveTown returns the slug itself ('ridgewood'), or null.
  const townSlug = entity.town ? resolveTown(entity.town) : null;
  const searchQuery = searchQueryFor(entity.name, entity.town);

  try {
    // A venue we already list is the strongest signal that the business is real.
    const existing = townSlug ? await findExistingVenue(entity.name, townSlug) : null;

    const searchResults = await searchBusiness(entity.name, entity.town);
    const website = (existing && existing.website) || extractBusinessWebsite(searchResults, entity.name);
    // The original story never counts as its own second source, venue match or not.
    const secondSource = findSecondSource(searchResults, { storyUrl, website, businessName: entity.name });

    const verificationData = {
      method: existing ? 'database_match' : 'web_search',
      searchQuery,
      resultsFound: searchResults.length,
      searchResults: searchResults.slice(0, 3).map(r => ({ url: r.url, title: r.title })),
      ...(existing ? { matchedVenue: existing.name, existingId: existing.id } : {})
    };

    let confidence;
    let unconfirmed;
    if (existing) {
      confidence = 'high';
      unconfirmed = secondSource ? [] : ['second source'];
    } else if (website && secondSource) {
      confidence = 'medium';
      unconfirmed = ['opening date', 'hours'];
    } else if (website || secondSource) {
      confidence = 'low';
      unconfirmed = ['opening date', 'hours', 'exact location', ...(secondSource ? [] : ['second source'])];
    } else {
      confidence = 'unverified';
      unconfirmed = ['all'];
    }

    return {
      name: entity.name,
      entityType: entityType(entity.type),
      townSlug: existing ? existing.town_slug : townSlug,
      address: existing ? existing.address : null,
      website: website || null,
      venueId: existing ? existing.id : null,
      confidence,
      verificationData,
      secondSourceUrl: secondSource,
      unconfirmed
    };
  } catch (error) {
    console.error('Verification error:', error);
    return {
      name: entity.name,
      entityType: entityType(entity.type),
      townSlug,
      address: null,
      website: null,
      venueId: null,
      confidence: 'unverified',
      verificationData: { error: error.message },
      secondSourceUrl: null,
      unconfirmed: ['all']
    };
  }
}

// Verify all entities from a story
async function verifyStory(storyId, { dryRun = false } = {}) {
  const story = await q(db().from('discovered_stories').select('*').eq('id', storyId).single());

  if (story.status !== 'new' && story.status !== 'processing') {
    return { skipped: true, reason: 'already processed', entities: [], extractedCount: 0 };
  }

  if (!dryRun) {
    await q(db().from('discovered_stories').update({ status: 'processing' }).eq('id', storyId));
  }

  const entities = await extractEntities(story);
  const verified = [];

  for (const entity of entities) {
    const verification = await verifyEntity(entity, story.url);

    if (!dryRun && verification.confidence !== 'unverified') {
      const inserted = await q(db().from('verified_entities').insert({
        story_id: storyId,
        entity_type: verification.entityType,
        name: verification.name,
        town_slug: verification.townSlug,
        address: verification.address,
        website: verification.website,
        confidence: verification.confidence,
        verification_data: verification.verificationData,
        second_source_url: verification.secondSourceUrl,
        venue_id: verification.venueId || null
      }).select('*').single());

      verified.push(inserted);
    } else if (dryRun) {
      verified.push(verification);
    }
  }

  if (!dryRun) {
    const newStatus = verified.length > 0 ? 'verified' : 'rejected';
    await q(db().from('discovered_stories').update({ status: newStatus }).eq('id', storyId));
  }

  return { entities: verified, extractedCount: entities.length };
}

// Run verification for all new stories
async function runVerification({ dryRun = false, limit = 50 } = {}) {
  const stories = await q(
    db().from('discovered_stories')
      .select('id')
      .in('status', ['new', 'processing'])
      .order('created_at', { ascending: true })
      .limit(limit)
  );

  const results = {
    storiesProcessed: 0,
    entitiesFound: 0,
    entitiesVerified: 0,
    entitiesHighConfidence: 0,
    errors: 0
  };

  for (const story of stories) {
    // One bad story must not stop the rest of the run. It stays 'processing' and is retried.
    try {
      const { entities, extractedCount } = await verifyStory(story.id, { dryRun });
      results.storiesProcessed++;
      results.entitiesFound += extractedCount;
      results.entitiesVerified += entities.length;
      results.entitiesHighConfidence += entities.filter(e => e.confidence === 'high').length;
    } catch (error) {
      console.error(`Verification failed for story ${story.id}:`, error.message);
      results.errors++;
    }
  }

  return results;
}

module.exports = {
  runVerification, verifyStory, extractEntities, verifyEntity,
  findSecondSource, extractBusinessWebsite, parseDuckDuckGo, parseJson, hostOf, ENTITY_TYPES
};
