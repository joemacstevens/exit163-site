// Discovery: fetch candidate stories from local news sources.
const { db, q } = require('./db');
const crypto = require('crypto');

// Feed text arrives as HTML with entities ("<p>Robby&#8217;s Pizza ...</p>"); make it plain text.
function cleanText(value) {
  if (value == null) return null;
  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse RSS/Atom feeds to extract stories
function parseRssFeed(xmlText) {
  const stories = [];
  
  // Simple regex-based RSS parser (works for most standard feeds)
  const itemPattern = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const entryPattern = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  
  const extractTag = (text, tag) => {
    const match = text.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, 'i')) ||
                  text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  };
  
  const extractLink = (text) => {
    const linkTag = extractTag(text, 'link');
    if (linkTag && /^https?:\/\//i.test(linkTag)) return linkTag.replace(/&amp;/g, '&');
    const match = text.match(/<link[^>]*href=["'](https?:\/\/[^"']+)["']/i);
    return match ? match[1].replace(/&amp;/g, '&') : null;
  };
  
  const extractDate = (text) => {
    const pubDate = extractTag(text, 'pubDate') || extractTag(text, 'published') || extractTag(text, 'updated');
    if (!pubDate) return null;
    const date = new Date(pubDate);
    return Number.isNaN(date.getTime()) ? null : date; // an unreadable date must not sink the run
  };
  
  // Try RSS format
  let matches = [...xmlText.matchAll(itemPattern)];
  
  // Try Atom format if no RSS items
  if (matches.length === 0) {
    matches = [...xmlText.matchAll(entryPattern)];
  }
  
  for (const match of matches) {
    const item = match[1];
    const title = cleanText(extractTag(item, 'title'));
    const link = extractLink(item);
    const description = cleanText(extractTag(item, 'description') || extractTag(item, 'summary') || extractTag(item, 'content'));
    const publishedAt = extractDate(item);
    
    if (title && link) {
      stories.push({ title, url: link, summary: description, publishedAt });
    }
  }
  
  return stories;
}

// Fetch stories from a single source
async function fetchSource(source) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Exit163Bot/1.0 (https://www.exit163.com; weekend@exit163.com)'
      },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    let stories = [];
    
    if (source.source_type === 'rss' || contentType.includes('xml') || contentType.includes('rss')) {
      const xmlText = await response.text();
      stories = parseRssFeed(xmlText);
    } else if (source.source_type === 'html') {
      // For HTML sources, we'd need more sophisticated extraction
      // For now, just mark as successful but return empty
      stories = [];
    }
    
    return { success: true, stories, error: null };
  } catch (error) {
    return { success: false, stories: [], error: error.message };
  }
}

// Generate deduplication hash
function dedupHash(url, title) {
  const normalized = `${url.toLowerCase().replace(/[?#].*$/, '')}|${title.toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// Filter stories to Bergen County relevant ones
function isBergenRelevant(story) {
  const text = `${story.title} ${story.summary || ''}`.toLowerCase();
  
  // Check for Bergen County mentions
  if (text.includes('bergen')) return true;
  
  // Check for town names (using common Bergen towns for now)
  const towns = [
    'ridgewood', 'hackensack', 'paramus', 'fair lawn', 'englewood', 'teaneck',
    'fort lee', 'mahwah', 'ramsey', 'wyckoff', 'glen rock', 'oakland',
    'rutherford', 'edgewater', 'westwood', 'river edge', 'tenafly'
  ];
  
  return towns.some(town => text.includes(town));
}

// Run discovery for all enabled sources
async function runDiscovery({ dryRun = false, maxStoriesPerSource = 20 } = {}) {
  const sources = await q(db().from('discovery_sources').select('*').eq('enabled', true));
  
  const results = {
    sourcesChecked: 0,
    storiesFound: 0,
    storiesNew: 0,
    storiesDuplicate: 0,
    sourceErrors: []
  };
  
  for (const source of sources) {
    results.sourcesChecked++;
    
    const { success, stories, error } = await fetchSource(source);
    
    if (!success) {
      results.sourceErrors.push({ source: source.name, error });
      if (!dryRun) {
        await q(db().from('discovery_sources').update({
          last_checked: new Date().toISOString(),
          last_error: error
        }).eq('id', source.id));
      }
      continue;
    }
    
    // Filter to Bergen relevant stories
    const relevantStories = stories.filter(isBergenRelevant).slice(0, maxStoriesPerSource);
    results.storiesFound += relevantStories.length;
    
    for (const story of relevantStories) {
      const hash = dedupHash(story.url, story.title);
      
      if (dryRun) {
        results.storiesNew++;
        continue;
      }
      
      // Check if already exists
      const existing = await q(db().from('discovered_stories').select('id').eq('dedup_hash', hash).maybeSingle());
      
      if (existing) {
        results.storiesDuplicate++;
        continue;
      }
      
      // Insert new story
      await q(db().from('discovered_stories').insert({
        source_id: source.id,
        url: story.url,
        title: story.title,
        summary: story.summary,
        published_at: story.publishedAt ? story.publishedAt.toISOString() : null,
        raw_content: story,
        dedup_hash: hash,
        status: 'new'
      }));
      
      results.storiesNew++;
    }
    
    if (!dryRun) {
      await q(db().from('discovery_sources').update({
        last_checked: new Date().toISOString(),
        last_success: new Date().toISOString(),
        last_error: null
      }).eq('id', source.id));
    }
  }
  
  return results;
}

// Seed initial sources
async function seedSources() {
  // Every URL here was fetched with this bot's own User-Agent and returned a feed (2026-11-15).
  // Left out on purpose: northjersey.com (answers 402 to bots), tapinto.net and bergenmama.com
  // (403 to bots). Do not add them back with a browser User-Agent; ask the publisher instead.
  const sources = [
    {
      name: 'Patch Ridgewood-Glen Rock',
      url: 'https://patch.com/feeds/new-jersey/ridgewood',
      source_type: 'rss',
      towns: ['Ridgewood', 'Glen Rock'],
      categories: ['community', 'other'],
      check_interval: 'daily',
      notes: 'Hyperlocal news'
    },
    {
      name: 'Patch Paramus',
      url: 'https://patch.com/feeds/new-jersey/paramus',
      source_type: 'rss',
      towns: ['Paramus'],
      categories: ['community', 'other'],
      check_interval: 'daily',
      notes: 'Hyperlocal news'
    },
    {
      name: 'Patch Hackensack',
      url: 'https://patch.com/feeds/new-jersey/hackensack',
      source_type: 'rss',
      towns: ['Hackensack'],
      categories: ['community', 'other'],
      check_interval: 'daily',
      notes: 'Hyperlocal news'
    },
    {
      name: 'Boozy Burbs',
      url: 'https://boozyburbs.com/feed/',
      source_type: 'rss',
      towns: ['Bergen County'],
      categories: ['food', 'nightlife'],
      check_interval: 'daily',
      notes: 'North Jersey restaurant and bar openings'
    }
  ];
  
  for (const source of sources) {
    const existing = await q(db().from('discovery_sources').select('id').eq('url', source.url).maybeSingle());
    if (!existing) {
      await q(db().from('discovery_sources').insert(source));
    }
  }
}

module.exports = { runDiscovery, seedSources, parseRssFeed, dedupHash, cleanText };
