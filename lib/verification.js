// Verification: confirm businesses/venues are real, resolve links and towns.
const { db, q } = require('./db');
const { resolveTown } = require('./towns');

// Extract business/venue mentions from story text
function extractEntities(story) {
  const text = `${story.title} ${story.summary || ''}`;
  const entities = [];
  
  // Common patterns for new businesses
  const patterns = [
    /(?:new|opening|opened|opens|coming to)\s+(?:restaurant|cafe|bar|brewery|shop|store|venue|gym|studio)?\s*[:\-]?\s*([A-Z][A-Za-z0-9\s&'.-]+?)(?:\s+(?:in|at|on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*))?/gi,
    /([A-Z][A-Za-z0-9\s&'.-]+?)\s+(?:opening|opens|opened|to open)\s+(?:in|at|on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    /([A-Z][A-Za-z0-9\s&'.-]+?)\s+(?:restaurant|cafe|bar|brewery|shop|store|venue|gym|studio)/gi
  ];
  
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const name = match[1]?.trim();
      const town = match[2]?.trim();
      
      if (name && name.length > 2 && name.length < 50) {
        // Filter out common false positives
        if (!/^(The|A|An|New|This|That|These|Those|Opening|Bergen|County|NJ|New Jersey)$/i.test(name)) {
          entities.push({
            type: 'business',
            name,
            town: town || null,
            confidence: town ? 'medium' : 'low'
          });
        }
      }
    }
  }
  
  return entities;
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

// Attempt to verify an entity using web search
async function verifyEntity(entity, storyUrl) {
  try {
    const searchQuery = entity.town
      ? `${entity.name} ${entity.town} New Jersey`
      : `${entity.name} Bergen County New Jersey`;
    
    // In production, this would use a real search API or web scraping
    // For now, we'll do basic validation and return unverified
    
    const verification = {
      name: entity.name,
      entityType: entity.type,
      townSlug: null,
      address: null,
      website: null,
      confidence: 'low',
      verificationData: {
        searchQuery,
        method: 'basic',
        note: 'Verification requires external search API or manual review'
      },
      secondSourceUrl: null,
      unconfirmed: ['location', 'opening date', 'hours', 'website']
    };
    
    // Try to resolve town if provided
    if (entity.town) {
      const resolved = resolveTown(entity.town);
      if (resolved) {
        verification.townSlug = resolved.slug;
        verification.confidence = 'medium';
        verification.unconfirmed = ['opening date', 'hours', 'website'];
      }
    }
    
    // Check if venue already exists in database
    if (verification.townSlug) {
      const existing = await findExistingVenue(entity.name, verification.townSlug);
      if (existing) {
        verification.venueId = existing.id;
        verification.townSlug = existing.town_slug;
        verification.address = existing.address;
        verification.website = existing.website;
        verification.confidence = 'high';
        verification.unconfirmed = [];
        verification.verificationData.matchedVenue = existing.name;
      }
    }
    
    return verification;
  } catch (error) {
    return {
      name: entity.name,
      entityType: entity.type,
      townSlug: null,
      confidence: 'unverified',
      verificationData: { error: error.message },
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
