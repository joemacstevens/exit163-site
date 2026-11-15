// POST /api/article-pipeline - Run the article-writer agent pipeline (cron job)
// Authorization: Bearer <ADMIN_TOKEN>
const { readBody } = require('../lib/http');
const { runPipeline } = require('../lib/articles');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Check authorization
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const body = await readBody(req);
    const dryRun = body.dry_run === true || body.dry_run === 'true';
    const steps = body.steps || ['discovery', 'verification', 'writing'];
    
    console.log('[article-pipeline] Starting pipeline run', { dryRun, steps });
    
    const result = await runPipeline({ dryRun, steps });
    
    console.log('[article-pipeline] Pipeline completed', {
      success: result.success,
      totalTime: result.totalTime,
      storiesDiscovered: result.steps.discovery?.storiesNew,
      entitiesVerified: result.steps.verification?.entitiesVerified,
      draftsCreated: result.steps.writing?.draftsCreated
    });
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('[article-pipeline] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
