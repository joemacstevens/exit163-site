// Writer: generate article drafts in Exit 163 voice using Claude.
const Anthropic = require('@anthropic-ai/sdk');
const { db, q } = require('./db');

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
      .order('confidence', { ascending: false })
  );
  
  if (entities.length === 0) {
    return { skipped: true, reason: 'no verified entities' };
  }
  
  // Use the highest confidence entity
  const primaryEntity = entities[0];
  
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
      max_tokens: 1000,
      system: WRITER_SYSTEM,
      output_config: { effort: EFFORT },
      messages: [{ role: 'user', content: prompt }]
    });
    
    const text = response.content.find(b => b.type === 'text')?.text || '';
    
    // Extract JSON from response (might have markdown code blocks)
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```(?:json)?\n?/g, '').trim();
    }
    
    const draft = JSON.parse(jsonText);
    
    // Validate required fields
    if (!draft.headline || !draft.body || !draft.category) {
      throw new Error('Missing required fields in draft');
    }
    
    if (dryRun) {
      return { draft, entity: primaryEntity, story };
    }
    
    // Insert draft into database
    const inserted = await q(db().from('article_drafts').insert({
      story_id: storyId,
      entity_id: primaryEntity.id,
      town_slug: draft.town_slug || primaryEntity.town_slug || 'bergen-county',
      category: draft.category,
      headline: draft.headline,
      body: draft.body,
      source_url: story.url,
      entity_link: draft.entity_link || primaryEntity.website,
      second_source_url: primaryEntity.second_source_url,
      confidence: draft.confidence || primaryEntity.confidence,
      unconfirmed_items: draft.unconfirmed_items || [],
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
