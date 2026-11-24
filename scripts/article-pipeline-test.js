#!/usr/bin/env node
// Seed sources, or run the article pipeline in dry-run mode, against the real database and APIs.
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY, e.g.:
//   node --env-file=.env.local scripts/article-pipeline-test.js dry-run
// For a run with no network, database or keys, use: node scripts/test-article-pipeline.js
const { seedSources } = require('../lib/discovery');
const { runPipeline } = require('../lib/articles');

async function main() {
  const command = process.argv[2];
  
  if (command === 'seed') {
    console.log('Seeding discovery sources...');
    await seedSources();
    console.log('✓ Discovery sources seeded');
    return;
  }
  
  if (command === 'dry-run' || !command) {
    console.log('Running article pipeline in DRY RUN mode...');
    console.log('(Nothing will be written to the database)\n');
    
    const result = await runPipeline({ dryRun: true });
    
    console.log('\n=== PIPELINE RESULTS ===');
    console.log(`Success: ${result.success}`);
    console.log(`Total time: ${(result.totalTime / 1000).toFixed(1)}s`);
    
    if (result.steps.discovery) {
      console.log('\nDiscovery:');
      console.log(`  Sources checked: ${result.steps.discovery.sourcesChecked}`);
      console.log(`  Stories found: ${result.steps.discovery.storiesFound}`);
      console.log(`  New stories: ${result.steps.discovery.storiesNew}`);
      console.log(`  Duplicates: ${result.steps.discovery.storiesDuplicate}`);
      if (result.steps.discovery.sourceErrors.length > 0) {
        console.log('  Errors:');
        result.steps.discovery.sourceErrors.forEach(e => {
          console.log(`    ${e.source}: ${e.error}`);
        });
      }
    }
    
    if (result.steps.verification) {
      console.log('\nVerification:');
      console.log(`  Stories processed: ${result.steps.verification.storiesProcessed}`);
      console.log(`  Entities found: ${result.steps.verification.entitiesFound}`);
      console.log(`  Entities verified: ${result.steps.verification.entitiesVerified}`);
      console.log(`  High confidence: ${result.steps.verification.entitiesHighConfidence}`);
    }
    
    if (result.steps.writing) {
      console.log('\nWriting:');
      console.log(`  Stories processed: ${result.steps.writing.storiesProcessed}`);
      console.log(`  Drafts created: ${result.steps.writing.draftsCreated}`);
      console.log(`  Drafts skipped: ${result.steps.writing.draftsSkipped}`);
      console.log(`  Errors: ${result.steps.writing.errors}`);
    }
    
    console.log('\n✓ Dry run completed');
    return;
  }
  
  console.log('Usage:');
  console.log('  node scripts/article-pipeline-test.js seed      # Seed initial discovery sources');
  console.log('  node scripts/article-pipeline-test.js dry-run   # Test pipeline without writing');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
