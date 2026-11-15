// Articles: main pipeline orchestration for article-writer agent.
const { db, q } = require('./db');
const { runDiscovery } = require('./discovery');
const { runVerification } = require('./verification');
const { runWriting } = require('./writer');

// Thrown when a review action targets a draft that is no longer waiting (the API answers 409).
class NotPendingError extends Error {}

// Run the full pipeline: discovery -> verification -> writing
async function runPipeline({ dryRun = false, steps = ['discovery', 'verification', 'writing'] } = {}) {
  const runId = dryRun ? null : await q(
    db().from('article_pipeline_runs').insert({
      run_type: 'full',
      dry_run: dryRun,
      started_at: new Date().toISOString()
    }).select('id').single()
  ).then(r => r.id);
  
  const results = {
    runId,
    dryRun,
    steps: {},
    startedAt: new Date().toISOString(),
    completedAt: null,
    totalTime: 0
  };
  
  try {
    // Step 1: Discovery
    if (steps.includes('discovery')) {
      console.log('[pipeline] Running discovery...');
      const discoveryStart = Date.now();
      const discovery = await runDiscovery({ dryRun, maxStoriesPerSource: 20 });
      results.steps.discovery = { ...discovery, timeMs: Date.now() - discoveryStart };
      
      if (!dryRun) {
        await q(db().from('article_pipeline_runs').update({
          stories_discovered: discovery.storiesNew
        }).eq('id', runId));
      }
    }
    
    // Step 2: Verification
    if (steps.includes('verification')) {
      console.log('[pipeline] Running verification...');
      const verificationStart = Date.now();
      const verification = await runVerification({ dryRun, limit: 50 });
      results.steps.verification = { ...verification, timeMs: Date.now() - verificationStart };
      
      if (!dryRun) {
        await q(db().from('article_pipeline_runs').update({
          entities_verified: verification.entitiesVerified
        }).eq('id', runId));
      }
    }
    
    // Step 3: Writing
    if (steps.includes('writing')) {
      console.log('[pipeline] Running writing...');
      const writingStart = Date.now();
      const writing = await runWriting({ dryRun, limit: 20 });
      results.steps.writing = { ...writing, timeMs: Date.now() - writingStart };
      
      if (!dryRun) {
        await q(db().from('article_pipeline_runs').update({
          drafts_created: writing.draftsCreated
        }).eq('id', runId));
      }
    }
    
    results.completedAt = new Date().toISOString();
    results.totalTime = Date.now() - new Date(results.startedAt).getTime();
    
    if (!dryRun) {
      await q(db().from('article_pipeline_runs').update({
        status: 'completed',
        completed_at: results.completedAt
      }).eq('id', runId));
    }
    
    return { success: true, ...results };
  } catch (error) {
    console.error('[pipeline] Error:', error);
    
    if (!dryRun && runId) {
      await q(db().from('article_pipeline_runs').update({
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      }).eq('id', runId));
    }
    
    return { success: false, error: error.message, ...results };
  }
}

// Approve a draft and publish it.
// The first update is the lock: only one caller can move a draft out of 'pending', so a double
// click or two tabs cannot publish it twice (published_articles.draft_id is also unique).
async function approveDraft(draftId, reviewedBy) {
  const claimed = await q(db().from('article_drafts').update({
    status: 'approved',
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString()
  }).eq('id', draftId).eq('status', 'pending').select('*'));
  
  if (!claimed || claimed.length === 0) {
    throw new NotPendingError('Draft is not pending approval');
  }
  
  const draft = claimed[0];
  
  // Publish the article
  let published;
  try {
    published = await q(db().from('published_articles').insert({
      draft_id: draftId,
      town_slug: draft.town_slug,
      category: draft.category,
      headline: draft.headline,
      body: draft.body,
      source_url: draft.source_url,
      entity_link: draft.entity_link,
      venue_id: null // Could be linked if entity_id references a venue
    }).select('*').single());
  } catch (error) {
    // Nothing was published: put the draft back so it can be approved again.
    await q(db().from('article_drafts').update({
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null
    }).eq('id', draftId).eq('status', 'approved'));
    throw error;
  }
  
  // Update draft with published timestamp
  await q(db().from('article_drafts').update({
    status: 'published',
    published_at: new Date().toISOString()
  }).eq('id', draftId));
  
  return published;
}

// Reject a draft. Only drafts still waiting on Joe can be rejected; a published one stays published.
async function rejectDraft(draftId, reviewedBy, reason) {
  const rejected = await q(db().from('article_drafts').update({
    status: 'rejected',
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
    rejection_reason: reason
  }).eq('id', draftId).in('status', ['pending', 'needs_manual_check']).select('id'));
  
  if (!rejected || rejected.length === 0) {
    throw new NotPendingError('Draft is not waiting for review');
  }
  
  return { rejected: true };
}

// Get pending drafts for review
async function getPendingDrafts({ limit = 50 } = {}) {
  return await q(
    db().from('article_drafts')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit)
  );
}

// Stories the pipeline would not write up because verification fell short (no second source).
async function getNeedsCheckDrafts({ limit = 50 } = {}) {
  return await q(
    db().from('article_drafts')
      .select('*')
      .eq('status', 'needs_manual_check')
      .order('created_at', { ascending: true })
      .limit(limit)
  );
}

// Get recent published articles
async function getRecentArticles({ townSlug = null, category = null, limit = 50 } = {}) {
  let query = db().from('published_articles')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(limit);
  
  if (townSlug) {
    query = query.eq('town_slug', townSlug);
  }
  
  if (category) {
    query = query.eq('category', category);
  }
  
  return await q(query);
}

// Get pipeline run history
async function getRunHistory({ limit = 10 } = {}) {
  return await q(
    db().from('article_pipeline_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit)
  );
}

module.exports = {
  runPipeline,
  approveDraft,
  rejectDraft,
  getPendingDrafts,
  getNeedsCheckDrafts,
  getRecentArticles,
  getRunHistory,
  NotPendingError
};
