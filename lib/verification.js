// Verification: confirm businesses/venues are real, resolve links and towns.
const Anthropic = require('@anthropic-ai/sdk');
const { db, q } = require('./db');
const { resolveTown } = require('./towns');
const { execSync } = require('child_process');

const MODEL = 'claude-haiku-5-5';
const EFFORT = 'low';

let client;
const anthropic = () => (client ||= new Anthropic());

// Extract business/venue mentions using Claude (more accurate than regex)
async function extractEntities(story) {
  const text = `Title: ${story.title}\n\nSummary: ${story.summary || 'N/A'}`;
  
  const prompt = `Extract business or venue names mentioned in this news story. Only include actual business names (restaurants, cafes, bars, shops, venues, etc.), not general references.

${text}

For each business, provide:
- name: The exact business name
- type: restaurant | cafe | bar | brewery | shop | store | venue | gym | studio | other
- town: Bergen County town if mentioned (or null)
- context: One sentence explaining why you extracted it

Return JSON array only, no other text. If no businesses are mentioned, return empty array.

Example: [{"name": "Blue Moon Cafe", "type": "cafe", "town": "Ridgewood", "context": "Article announces this new cafe is opening"}]`;

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 500,
      system: 'You extract structured data from text. Return only valid JSON, no other text.',
      output_config: { effort: EFFORT },
      messages: [{ role: 'user', content: prompt }]
    });
    
    const text = response.content.find(b => b.type === 'text')?.text || '[]';
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```(?:json)?\n?/g, '').trim();
    }
    
    const entities = JSON.parse(jsonText);
    return Array.isArray(entities) ? entities : [];
  } catch (error) {
    console.error('Entity extraction error:', error.message);
    return [];
  }
}

// Search for existing venue in database
async function findExistingVenue(entityName, townSlug) {
  const nameQuery = entityName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  
  let query = db().from('venues').select('id,name,town_slug,address,website,category').eq('status', 'open');
  
  if (townSlug) {
    query = query.eq('town_slug', townSlug);
  }
  
  const venues = await q(query);
  
  // Simple fuzzy match
  for (const venue of venues) {
    const venueName = venue.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    if (venueName === nameQuery || venueName.includes(nameQuery) || nameQuery.includes(venueName)) {
      return venue;
    }
  }
  
  return null;
}

// Search for business info using Firecrawl
async function searchBusiness(businessName, town) {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  
  if (!firecrawlKey) {
    // Fall back to basic Google search via fetch (no API key needed)
    return searchWithBasicFetch(businessName, town);
  }
  
  try {
    const searchQuery = town
      ? `${businessName} ${town} New Jersey`
      : `${businessName} Bergen County New Jersey`;
    
    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlKey}`
      },
      body: JSON.stringify({
        query: searchQuery,
        limit: 5
      })
    });
    
    if (!response.ok) {
      throw new Error(`Firecrawl search failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Firecrawl search error:', error.message);
    return searchWithBasicFetch(businessName, town);
  }
}

// Fallback: basic Google search via fetch (no API key)
async function searchWithBasicFetch(businessName, town) {
  try {
    const query = town
      ? `${businessName} ${town} New Jersey`
      : `${businessName} Bergen County New Jersey`;
    
    // Use DuckDuckGo HTML (simpler than Google, no CAPTCHA)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Exit163Bot/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) return [];
    
    const html = await response.text();
    
    // Extract search result URLs (simple regex for DuckDuckGo HTML)
    const results = [];
    const urlPattern = /uddg=([^"&]+)/g;
    let match;
    let count = 0;
    
    while ((match = urlPattern.exec(html)) !== null && count < 5) {
      try {
        const decodedUrl = decodeURIComponent(match[1]);
        if (decodedUrl.startsWith('http') && !decodedUrl.includes('duckduckgo.com')) {
          results.push({ url: decodedUrl, title: '', description: '' });
          count++;
        }
      } catch (e) {
        // Skip malformed URLs
      }
    }
    
    return results;
  } catch (error) {
    console.error('Basic search error:', error.message);
    return [];
  }
}

// Find a second independent source (not the original story)
function findSecondSource(searchResults, originalStoryUrl) {
  // Exclude the original story and social media
  const excluded = [
    originalStoryUrl,
    'facebook.com',
    'instagram.com',
    'twitter.com',
    'x.com'
  ];
  
  for (const result of searchResults) {
    const url = result.url || result.link || '';
    const isExcluded = excluded.some(ex => url.includes(ex));
    
    if (!isExcluded && url.length > 0) {
      return url;
    }
  }
  
  return null;
}

// Extract business website from search results
function extractBusinessWebsite(searchResults, businessName) {
  const nameLower = businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  for (const result of searchResults) {
    const url = result.url || result.link || '';
    const urlLower = url.toLowerCase();
    
    // Look for official website or business listing
    if (urlLower.includes(nameLower) || 
        urlLower.includes('yelp.com') ||
        urlLower.includes('google.com/maps') ||
        urlLower.includes('tripadvisor.com')) {
      return url;
    }
  }
  
  // Return first non-news result
  for (const result of searchResults) {
    const url = result.url || result.link || '';
    if (!url.includes('/news/') && !url.includes('/article/')) {
      return url;
    }
  }
  
  return null;
}

// Attempt to verify an entity using web search
async function verifyEntity(entity, storyUrl) {
  try {
    // Try to resolve town first
    let townSlug = null;
    if (entity.town) {
      const resolved = resolveTown(entity.town);
      if (resolved) {
        townSlug = resolved.slug;
      }
    }
    
    // Check if venue already exists in database (highest confidence)
    if (townSlug) {
      const existing = await findExistingVenue(entity.name, townSlug);
      if (existing) {
        return {
          name: entity.name,
          entityType: entity.type,
          townSlug: existing.town_slug,
          address: existing.address,
          website: existing.website,
          venueId: existing.id,
          confidence: 'high',
          verificationData: {
            method: 'database_match',
            matchedVenue: existing.name,
            existingId: existing.id
          },
          secondSourceUrl: storyUrl, // Original story is the source
          unconfirmed: []
        };
      }
    }
    
    // Search the web for the business
    const searchResults = await searchBusiness(entity.name, entity.town);
    
    if (searchResults.length === 0) {
      return {
        name: entity.name,
        entityType: entity.type,
        townSlug: townSlug,
        confidence: 'unverified',
        verificationData: {
          method: 'web_search',
          searchQuery: entity.town ? `${entity.name} ${entity.town} NJ` : `${entity.name} Bergen County NJ`,
          resultsFound: 0
        },
        secondSourceUrl: null,
        unconfirmed: ['all']
      };
    }
    
    // Extract website and second source
    const website = extractBusinessWebsite(searchResults, entity.name);
    const secondSource = findSecondSource(searchResults, storyUrl);
    
    // Determine confidence based on what we found
    let confidence = 'low';
    let unconfirmed = ['opening date', 'hours', 'exact location'];
    
    if (website && secondSource) {
      confidence = 'medium';
      unconfirmed = ['opening date', 'hours'];
    } else if (website || secondSource) {
      confidence = 'low';
      unconfirmed = ['opening date', 'hours', 'exact location', 'second source'];
    }
    
    return {
      name: entity.name,
      entityType: entity.type,
      townSlug: townSlug,
      address: null,
      website: website,
      confidence: confidence,
      verificationData: {
        method: 'web_search',
        searchQuery: entity.town ? `${entity.name} ${entity.town} NJ` : `${entity.name} Bergen County NJ`,
        resultsFound: searchResults.length,
        searchResults: searchResults.slice(0, 3).map(r => ({ url: r.url || r.link, title: r.title }))
      },
      secondSourceUrl: secondSource,
      unconfirmed: unconfirmed
    };
  } catch (error) {
    console.error('Verification error:', error);
    return {
      name: entity.name,
      entityType: entity.type,
      townSlug: null,
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
    return { skipped: true, reason: 'already processed' };
  }
  
  if (!dryRun) {
    await q(db().from('discovered_stories').update({ status: 'processing' }).eq('id', storyId));
  }
  
  const entities = extractEntities(story);
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
    entitiesHighConfidence: 0
  };
  
  for (const story of stories) {
    const { entities, extractedCount } = await verifyStory(story.id, { dryRun });
    results.storiesProcessed++;
    results.entitiesFound += extractedCount;
    results.entitiesVerified += entities.length;
    results.entitiesHighConfidence += entities.filter(e => e.confidence === 'high').length;
  }
  
  return results;
}

module.exports = { runVerification, verifyStory, extractEntities, verifyEntity };
