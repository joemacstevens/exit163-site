// GET/POST /api/article-review - Review and manage article drafts
// Authorization: Bearer <ADMIN_TOKEN>
const { readBody } = require('../lib/http');
const { getPendingDrafts, getNeedsCheckDrafts, approveDraft, rejectDraft, getRecentArticles, NotPendingError } = require('../lib/articles');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Check authorization
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    if (req.method === 'GET') {
      // Return pending drafts and recent articles
      const pending = await getPendingDrafts({ limit: 50 });
      const needsCheck = await getNeedsCheckDrafts({ limit: 50 });
      const recent = await getRecentArticles({ limit: 20 });
      
      return res.status(200).json({
        pending,
        needsCheck,
        recent,
        counts: {
          pendingDrafts: pending.length,
          needsCheck: needsCheck.length
        }
      });
    }
    
    if (req.method === 'POST') {
      const body = await readBody(req);
      const { action, draft_id, reviewed_by, reason } = body;
      
      if (!draft_id) {
        return res.status(400).json({ error: 'draft_id is required' });
      }
      
      if (action === 'approve') {
        const published = await approveDraft(draft_id, reviewed_by || 'admin');
        return res.status(200).json({ success: true, published });
      }
      
      if (action === 'reject') {
        await rejectDraft(draft_id, reviewed_by || 'admin', reason || 'No reason provided');
        return res.status(200).json({ success: true, rejected: true });
      }
      
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "reject"' });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (error instanceof NotPendingError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[article-review] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
