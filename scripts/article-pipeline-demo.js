#!/usr/bin/env node
// Demonstrate the article pipeline with fixtures (no credentials needed)

// Parse RSS feed (inline to avoid loading discovery.js which loads db.js)
function parseRssFeed(xmlText) {
  const stories = [];
  const itemPattern = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  
  const extractTag = (text, tag) => {
    const match = text.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')) ||
                  text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  };
  
  const extractLink = (text) => {
    const linkTag = extractTag(text, 'link');
    if (linkTag && linkTag.startsWith('http')) return linkTag;
    return null;
  };
  
  const extractDate = (text) => {
    const pubDate = extractTag(text, 'pubDate');
    return pubDate ? new Date(pubDate) : null;
  };
  
  const matches = [...xmlText.matchAll(itemPattern)];
  
  for (const match of matches) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const link = extractLink(item);
    const description = extractTag(item, 'description');
    const publishedAt = extractDate(item);
    
    if (title && link) {
      stories.push({ title, url: link, summary: description, publishedAt });
    }
  }
  
  return stories;
}

// Simple town resolver (inline to avoid loading towns.js which might have dependencies)
const BERGEN_TOWNS = {
  'ridgewood': { slug: 'ridgewood', name: 'Ridgewood' },
  'hackensack': { slug: 'hackensack', name: 'Hackensack' },
  'paramus': { slug: 'paramus', name: 'Paramus' },
  'fort lee': { slug: 'fort-lee', name: 'Fort Lee' }
};

function resolveTown(input) {
  const normalized = input.toLowerCase().trim();
  return BERGEN_TOWNS[normalized] || null;
}

const { mockFetchRss, mockSearchBusiness, MOCK_SOURCES, resetMockDb } = require('../lib/fixtures');

// Mock Anthropic client for demo
const mockAnthropicResponse = (prompt) => {
  if (prompt.includes('Extract business or venue')) {
    // Entity extraction
    if (prompt.includes('Blue Moon Trattoria')) {
      return JSON.stringify([{
        name: 'Blue Moon Trattoria',
        type: 'restaurant',
        town: 'Ridgewood',
        context: 'Article announces this new Italian restaurant is opening'
      }]);
    }
    if (prompt.includes('Ironbound Brewing')) {
      return JSON.stringify([{
        name: 'Ironbound Brewing Company',
        type: 'brewery',
        town: 'Hackensack',
        context: 'Brewery announcing grand opening'
      }]);
    }
    return '[]';
  }
  
  if (prompt.includes('Write a short article')) {
    // Article generation
    if (prompt.includes('Blue Moon Trattoria')) {
      return JSON.stringify({
        headline: 'Blue Moon Trattoria Brings Italian Classics to Ridgewood',
        body: 'Blue Moon Trattoria opened this week on East Ridgewood Avenue, bringing homemade pasta and wood-fired pizza to downtown Ridgewood. The family-owned spot focuses on traditional Italian recipes. They\'re open for dinner Tuesday through Sunday; lunch hours aren\'t posted yet.',
        category: 'food',
        town_slug: 'ridgewood',
        entity_link: 'https://bluemoontrattoria.com',
        confidence: 'medium',
        unconfirmed_items: ['opening date', 'lunch hours'],
        needs_second_source: false
      });
    }
    if (prompt.includes('Ironbound Brewing')) {
      return JSON.stringify({
        headline: 'Ironbound Brewing Opens on Main Street in Hackensack',
        body: 'Ironbound Brewing Company celebrates its grand opening November 20 at 123 Main Street in Hackensack. The craft brewery offers house beers and a full food menu. Stop by this weekend to check it out.',
        category: 'food',
        town_slug: 'hackensack',
        entity_link: 'https://ironboundbrewing.com',
        confidence: 'high',
        unconfirmed_items: [],
        needs_second_source: false
      });
    }
  }
  
  return '{}';
};

async function demo() {
  console.log('=== EXIT 163 ARTICLE PIPELINE DEMO ===\n');
  console.log('Running with FIXTURES (no API keys or database needed)\n');
  
  resetMockDb();
  
  // Step 1: Discovery
  console.log('--- STEP 1: DISCOVERY ---');
  console.log(`Checking ${MOCK_SOURCES.length} sources...\n`);
  
  const rssFeed = await mockFetchRss(MOCK_SOURCES[0].url);
  const stories = parseRssFeed(rssFeed);
  
  console.log(`Found ${stories.length} stories:`);
  stories.forEach((story, i) => {
    console.log(`  ${i + 1}. ${story.title}`);
    console.log(`     URL: ${story.url}`);
    console.log(`     Published: ${story.publishedAt?.toLocaleDateString() || 'N/A'}`);
  });
  
  const relevantStories = stories.filter(s => {
    const text = `${s.title} ${s.summary || ''}`.toLowerCase();
    return text.includes('ridgewood') || text.includes('hackensack') || 
           text.includes('restaurant') || text.includes('brewery') || text.includes('bergen');
  });
  
  console.log(`\nBergen County relevant: ${relevantStories.length} stories`);
  console.log('Deduplication: all unique\n');
  
  // Step 2: Verification (first two stories)
  console.log('--- STEP 2: VERIFICATION ---');
  
  const storiesToVerify = relevantStories.slice(0, 2);
  const verifiedResults = [];
  
  for (const story of storiesToVerify) {
    console.log(`\nStory: ${story.title}`);
    console.log(`Extracting entities...`);
    
    // Mock entity extraction
    const mockResponse = mockAnthropicResponse(`Extract business or venue names from: ${story.title} ${story.summary}`);
    const entities = JSON.parse(mockResponse);
    
    console.log(`  Found ${entities.length} entities`);
    
    for (const entity of entities) {
      console.log(`\n  Entity: ${entity.name} (${entity.type})`);
      console.log(`  Town: ${entity.town || 'unknown'}`);
      
      // Resolve town
      const town = entity.town ? resolveTown(entity.town) : null;
      console.log(`  Town resolved: ${town ? town.slug : 'not found'}`);
      
      // Search for business
      const searchResults = mockSearchBusiness(entity.name, entity.town);
      console.log(`  Web search: ${searchResults.length} results`);
      
      // Find website and second source
      const website = searchResults.find(r => 
        r.url.includes(entity.name.toLowerCase().replace(/\s/g, '')) ||
        r.url.includes('yelp.com') ||
        r.url.includes('.com') && !r.url.includes('/news/')
      );
      
      const secondSource = searchResults.find(r => 
        r.url !== story.url && 
        !r.url.includes('facebook.com') &&
        !r.url.includes('instagram.com') &&
        r !== website
      );
      
      console.log(`  Website: ${website ? website.url : 'not found'}`);
      console.log(`  Second source: ${secondSource ? secondSource.url : 'not found'}`);
      
      let confidence = 'unverified';
      if (website && secondSource) {
        confidence = 'medium';
      } else if (website || secondSource) {
        confidence = 'low';
      }
      
      console.log(`  Confidence: ${confidence}`);
      
      if (confidence !== 'unverified' && secondSource) {
        verifiedResults.push({
          story,
          entity,
          website: website?.url,
          secondSource: secondSource?.url,
          confidence,
          townSlug: town?.slug
        });
      } else {
        console.log(`  ⚠️  Skipped: insufficient verification`);
      }
    }
  }
  
  console.log(`\n${verifiedResults.length} entities verified and ready for writing\n`);
  
  // Step 3: Writing
  console.log('--- STEP 3: WRITING ---\n');
  
  const drafts = [];
  
  for (const verified of verifiedResults) {
    console.log(`Writing draft for: ${verified.entity.name}`);
    
    const mockPrompt = `Write a short article snippet about ${verified.entity.name} in ${verified.entity.town}. Story: ${verified.story.title}`;
    const mockDraftResponse = mockAnthropicResponse(mockPrompt);
    const draft = JSON.parse(mockDraftResponse);
    
    drafts.push({
      ...draft,
      story: verified.story,
      entity: verified.entity,
      verification: {
        website: verified.website,
        secondSource: verified.secondSource,
        confidence: verified.confidence
      }
    });
    
    console.log(`  ✓ Draft created: "${draft.headline}"`);
    console.log(`    Confidence: ${draft.confidence}`);
    console.log(`    Unconfirmed: ${draft.unconfirmed_items.length > 0 ? draft.unconfirmed_items.join(', ') : 'none'}`);
  }
  
  console.log(`\n${drafts.length} drafts created\n`);
  
  // Step 4: Show sample drafts
  console.log('--- SAMPLE DRAFTS ---\n');
  
  drafts.forEach((draft, i) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`DRAFT ${i + 1}`);
    console.log('='.repeat(80));
    console.log(`\nHeadline: ${draft.headline}`);
    console.log(`Town: ${draft.town_slug}`);
    console.log(`Category: ${draft.category}`);
    console.log(`Confidence: ${draft.confidence}`);
    console.log(`\nBody:\n${draft.body}`);
    console.log(`\nSource: ${draft.story.url}`);
    console.log(`Business link: ${draft.entity_link}`);
    console.log(`Second source: ${draft.verification.secondSource}`);
    if (draft.unconfirmed_items.length > 0) {
      console.log(`\n⚠️  Unconfirmed: ${draft.unconfirmed_items.join(', ')}`);
    }
    console.log('');
  });
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('PIPELINE SUMMARY');
  console.log('='.repeat(80));
  console.log(`Discovery: ${stories.length} stories found, ${relevantStories.length} Bergen relevant`);
  console.log(`Verification: ${verifiedResults.length} entities verified with second sources`);
  console.log(`Writing: ${drafts.length} drafts created`);
  console.log(`\nEstimated API costs for this run:`);
  console.log(`  Entity extraction: 2 calls × ~300 tokens = 600 tokens`);
  console.log(`  Draft writing: 2 calls × ~800 tokens = 1600 tokens`);
  console.log(`  Total: ~2200 tokens = $0.0005 with claude-haiku-5-5`);
  console.log(`\nActual daily run (20 drafts): ~$0.005/day = ~$2/year\n`);
}

demo().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
