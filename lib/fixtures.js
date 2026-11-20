// Fixtures for dry-run testing (no database or API credentials needed)

const MOCK_SOURCES = [
  {
    id: 1,
    name: 'NorthJersey.com Bergen County',
    url: 'https://www.northjersey.com/rss/bergen/',
    source_type: 'rss',
    towns: ['Bergen County'],
    categories: ['community', 'other'],
    enabled: true,
    check_interval: 'daily'
  },
  {
    id: 2,
    name: 'TAPinto Ridgewood',
    url: 'https://www.tapinto.net/towns/ridgewood/rss.xml',
    source_type: 'rss',
    towns: ['Ridgewood'],
    categories: ['community', 'food', 'other'],
    enabled: true,
    check_interval: 'daily'
  }
];

const MOCK_RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Bergen County News</title>
    <item>
      <title>New Italian Restaurant Blue Moon Trattoria Opens in Ridgewood</title>
      <link>https://example.com/news/blue-moon-opens-ridgewood</link>
      <description>Blue Moon Trattoria, a family-owned Italian restaurant, opened its doors on East Ridgewood Avenue this week. The restaurant features homemade pasta and wood-fired pizza.</description>
      <pubDate>Thu, 14 Nov 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Hackensack Brewery Announces Grand Opening</title>
      <link>https://example.com/news/ironbound-brewery-hackensack</link>
      <description>Ironbound Brewing Company will celebrate its grand opening at 123 Main Street in Hackensack on November 20. The brewery offers craft beers and a full food menu.</description>
      <pubDate>Wed, 13 Nov 2026 15:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Garden State Plaza Announces Holiday Shopping Hours</title>
      <link>https://example.com/news/gsp-holiday-hours</link>
      <description>Garden State Plaza in Paramus will extend its shopping hours for the holiday season, opening at 9am daily starting November 25.</description>
      <pubDate>Tue, 12 Nov 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Fort Lee Opens New Waterfront Park</title>
      <link>https://example.com/news/fort-lee-park-opens</link>
      <description>The Borough of Fort Lee cut the ribbon on a new waterfront park with Hudson River views. The park features walking trails and a playground.</description>
      <pubDate>Mon, 11 Nov 2026 11:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const MOCK_VENUES = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Ironbound Brewing Company',
    town_slug: 'hackensack',
    address: '123 Main Street',
    category: 'food',
    website: 'https://ironboundbrewing.com',
    verified: true,
    status: 'open'
  }
];

const MOCK_SEARCH_RESULTS = {
  'blue moon trattoria ridgewood': [
    { url: 'https://example.com/news/blue-moon-opens-ridgewood', title: 'Original news article' },
    { url: 'https://bluemoontrattoria.com', title: 'Blue Moon Trattoria - Official Site' },
    { url: 'https://yelp.com/biz/blue-moon-trattoria-ridgewood', title: 'Blue Moon Trattoria - Yelp' },
    { url: 'https://tapinto.net/towns/ridgewood/sections/food-and-drink/articles/blue-moon-trattoria-brings-italian-classics-to-ridgewood', title: 'TAPinto: Blue Moon Trattoria Brings Italian Classics' }
  ],
  'ironbound brewing company hackensack': [
    { url: 'https://example.com/news/ironbound-brewery-hackensack', title: 'Original news article' },
    { url: 'https://ironboundbrewing.com', title: 'Ironbound Brewing - Official Site' },
    { url: 'https://northjersey.com/story/food/beer/2026/11/13/ironbound-brewing-hackensack', title: 'NorthJersey: Ironbound Brewing opens in Hackensack' }
  ]
};

// Mock search function for dry-run
function mockSearchBusiness(businessName, town) {
  const key = `${businessName} ${town || 'bergen county'}`.toLowerCase();
  
  for (const [searchKey, results] of Object.entries(MOCK_SEARCH_RESULTS)) {
    if (key.includes(searchKey) || searchKey.includes(businessName.toLowerCase())) {
      return results;
    }
  }
  
  return [];
}

// Mock fetch for RSS feeds
async function mockFetchRss(url) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));
  return MOCK_RSS_FEED;
}

// Mock database queries
const mockDb = {
  sources: MOCK_SOURCES,
  venues: MOCK_VENUES,
  discoveredStories: [],
  verifiedEntities: [],
  articleDrafts: []
};

function resetMockDb() {
  mockDb.discoveredStories = [];
  mockDb.verifiedEntities = [];
  mockDb.articleDrafts = [];
}

module.exports = {
  MOCK_SOURCES,
  MOCK_RSS_FEED,
  MOCK_VENUES,
  MOCK_SEARCH_RESULTS,
  mockSearchBusiness,
  mockFetchRss,
  mockDb,
  resetMockDb
};
