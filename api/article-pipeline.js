// /api/article-pipeline - run the article-writer agent pipeline.
// Vercel cron (see vercel.json) calls this with GET and "Authorization: Bearer $CRON_SECRET".
// By hand:
//   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://www.exit163.com/api/article-pipeline?dry_run=1"
const { readBody } = require('../lib/http');
const { runPipeline } = require('../lib/articles');

const STEPS = ['discovery', 'verification', 'writing'];

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Same check as /api/reflect: the cron's secret or the admin token.
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.ADMIN_TOKEN].filter(Boolean).some((t) => auth === `Bearer ${t}`);
  if (!ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const url = new URL(req.url, 'http://x');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const flag = body.dry_run ?? url.searchParams.get('dry_run');
    const dryRun = flag === true || flag === 'true' || flag === '1';
    
    // steps: ["discovery","writing"] in the body, or ?steps=discovery,writing
    const asked = body.steps ?? url.searchParams.get('steps');
    const list = Array.isArray(asked) ? asked : asked ? String(asked).split(',') : STEPS;
    const steps = list.map((s) => String(s).trim()).filter((s) => STEPS.includes(s));
    if (steps.length === 0) {
      return res.status(400).json({ error: `steps must be one or more of: ${STEPS.join(', ')}` });
    }
    
    console.log('[article-pipeline] Starting pipeline run', { dryRun, steps });
    
    const result = await runPipeline({ dryRun, steps });
    
    console.log('[article-pipeline] Pipeline completed', {
      success: result.success,
      totalTime: result.totalTime,
      storiesDiscovered: result.steps.discovery?.storiesNew,
      entitiesVerified: result.steps.verification?.entitiesVerified,
      draftsCreated: result.steps.writing?.draftsCreated
    });
    
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('[article-pipeline] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
