// Writer: generate article drafts in Exit 163 voice using Claude.
const Anthropic = require('@anthropic-ai/sdk');
const { db, q } = require('./db');
const { resolveTown } = require('./towns');
const { parseJson, hostOf } = require('./verification');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const EFFORT = 'low';

const WRITER_SYSTEM = `You are a writer for Exit 163, a faceless Bergen County, NJ "what to do this weekend" brand. Your voice is a friend who knows every town: specific about place and time, honest about what you don't know, never clickbait, never invented details.

Editorial rules:
- Weekend plans first: events, food openings, family picks, date nights, HS sports. Hard news only as short Quick Hits.
- Every item needs two sources or gets flagged as unverified.
- Be specific about town and time. If something isn't posted yet (time, date, price), say so honestly: "time not posted yet", "they don't say", "opening date TBA".
- Never invent details. Only include what the sources actually state.
- No clickbait. No "you won't believe", no "must-try", no "hidden gem" unless it genuinely is unknown.
- Link directly to the entity (the business's own website or listing), not just the news article.
- Clear source attribution for everything.

Your writing style:
- Short, punchy snippets (2-4 sentences, 100-200 words max)
- Lead with what matters: the name, what it is, where, when (if applicable)
- One detail that makes it interesting (the specialty, the backstory, what makes it notable)
- End with practical info: how to visit, hours if known, or what to expect
- Natural, conversational but informative
- Plain text, no markdown

Output format (JSON):
{
  "headline": "Short, specific headline (5-8 words)",
  "body": "The article snippet in Exit 163 voice",
  "category": "food | family | nightlife | arts | sports | community | other",
  "town_slug": "bergen-county | ridgewood | hackensack | ...",
  "entity_link": "Direct link to the business/venue itself",
  "confidence": "high | medium | low",
  "unconfirmed_items": ["opening date", "hours", "price", ...],
  "needs_second_source": true | false
}`;

const CATEGORIES = ['food', 'family', 'nightlife', 'arts', 'sports', 'community', 'other'];
// Best first. (Sorting the text column in SQL would put 'medium' ahead of 'high'.)
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, unverified: 0 };
const rank = (c) => CONFIDENCE_RANK[c] ?? 0;

let client;
const anthropic = () => (client ||= new Anthropic());

// Generate an article draft from a verified story
async function generateDraft(storyId, { dryRun = false } = {}) {
  // Get story and its verified entities
  const story = await q(db().from('discovered_stories').select('*').eq('id', storyId).single());
  
  const entities = await q(
    db().from('verified_entities')
      .select('*')
      .eq('story_id', storyId)
  );
  
  if (entities.length === 0) {
    return { skipped: true, reason: 'no verified entities' };
  }
  
  // Use the highest confidence entity; among equals, one that has a second source.
  const primaryEntity = [...entities].sort((a, b) =>
    rank(b.confidence) - rank(a.confidence) || (b.second_source_url ? 1 : 0) - (a.second_source_url ? 1 : 0)
  )[0];
  
  // Require proper verification: confidence not 'unverified' AND has second source
  if (primaryEntity.confidence === 'unverified' || !primaryEntity.second_source_url) {
    if (!dryRun) {
      // Mark draft as needs manual check instead of writing it
      await q(db().from('article_drafts').insert({
        story_id: storyId,
        entity_id: primaryEntity.id,
        town_slug: primaryEntity.town_slug || 'bergen-county',
        category: 'other',
        headline: `[NEEDS VERIFICATION] ${primaryEntity.name}`,
        body: `Story about ${primaryEntity.name} needs manual verification. Entity confidence: ${primaryEntity.confidence}. Source: ${story.url}`,
        source_url: story.url,
        entity_link: primaryEntity.website,
        second_source_url: primaryEntity.second_source_url,
        confidence: 'low',
        unconfirmed_items: ['all'],
        status: 'needs_manual_check'
      }));
      // Take the story out of the writing queue, or it gets a new placeholder draft every run.
      await q(db().from('discovered_stories').update({ status: 'needs_manual_check' }).eq('id', storyId));
    }
    return { skipped: true, reason: 'insufficient verification - needs manual check' };
  }
  
  const prompt = `Write a short article snippet about this story for Exit 163.

Source article:
Title: ${story.title}
URL: ${story.url}
Summary: ${story.summary || 'N/A'}

Verified entity:
Name: ${primaryEntity.name}
Type: ${primaryEntity.entity_type}
Town: ${primaryEntity.town_slug || 'unknown'}
Address: ${primaryEntity.address || 'unknown'}
Website: ${primaryEntity.website || 'unknown'}
Confidence: ${primaryEntity.confidence}
Verification notes: ${JSON.stringify(primaryEntity.verification_data)}

Write an original snippet in Exit 163 voice. Do not paraphrase the source article. Write as if you're a local friend sharing this news. Include clear attribution to the source article and link to the entity itself (its website) if available.

Respond with valid JSON only, no other text.`;

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 4000, // thinking counts against this; leave room for the snippet after it
      system: WRITER_SYSTEM,
      output_config: { effort: EFFORT },
      messages: [{ role: 'user', content: prompt }]
    });
    
    if (response.stop_reason === 'refusal') {
      throw new Error('Model declined to write this draft');
    }
    
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const draft = parseJson(text);
    
    // Validate required fields
    if (!draft.headline || !draft.body) {
      throw new Error('Missing required fields in draft');
    }
    
    // The model's reply is a suggestion, not a fact. Keep only values the tables accept, and
    // never let it raise the confidence or supply a link that verification did not find.
    const category = CATEGORIES.includes(draft.category) ? draft.category : 'other';
    const townSlug = resolveTown(draft.town_slug) || primaryEntity.town_slug || 'bergen-county';
    const confidence = rank(draft.confidence) > 0 && rank(draft.confidence) < rank(primaryEntity.confidence)
      ? draft.confidence
      : primaryEntity.confidence;
    const unconfirmed = (Array.isArray(draft.unconfirmed_items) ? draft.unconfirmed_items : [])
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => item.trim().slice(0, 80))
      .slice(0, 10);
    const entityLink = hostOf(primaryEntity.website) ? primaryEntity.website : null;
    
    const clean = {
      headline: String(draft.headline).trim(),
      body: String(draft.body).trim(),
      category,
      town_slug: townSlug,
      entity_link: entityLink,
      confidence,
      unconfirmed_items: unconfirmed
    };
    
    if (dryRun) {
      return { draft: clean, entity: primaryEntity, story };
    }
    
    // Insert draft into database
    const inserted = await q(db().from('article_drafts').insert({
      story_id: storyId,
      entity_id: primaryEntity.id,
      ...clean,
      source_url: story.url,
      second_source_url: primaryEntity.second_source_url,
      raw_generation: { response: draft, model: MODEL, prompt },
      status: 'pending'
    }).select('*').single());
    
    // Update story status
    await q(db().from('discovered_stories').update({ status: 'published' }).eq('id', storyId));
    
    return { draft: inserted, entity: primaryEntity };
  } catch (error) {
    console.error('Draft generation error:', error);
    return { error: error.message };
  }
}

// Run writing for all verified stories
async function runWriting({ dryRun = false, limit = 20 } = {}) {
  const stories = await q(
    db().from('discovered_stories')
      .select('id')
      .eq('status', 'verified')
      .order('created_at', { ascending: true })
      .limit(limit)
  );
  
  const results = {
    storiesProcessed: 0,
    draftsCreated: 0,
    draftsSkipped: 0,
    errors: 0
  };
  
  for (const story of stories) {
    const result = await generateDraft(story.id, { dryRun });
    
    if (result.skipped) {
      results.draftsSkipped++;
    } else if (result.error) {
      results.errors++;
    } else {
      results.draftsCreated++;
    }
    
    results.storiesProcessed++;
    
    // Rate limiting: small delay between API calls
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

module.exports = { runWriting, generateDraft, WRITER_SYSTEM };
