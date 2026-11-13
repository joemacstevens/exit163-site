// Nightly memory review (Vercel cron, see vercel.json). Also callable by hand:
//   curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://www.exit163.com/api/reflect?dry_run=1"
// Vercel cron sends "Authorization: Bearer $CRON_SECRET".
const { reviewAll } = require('../lib/reflect');
const followups = require('../lib/followups');

const mask = (p) => (p ? p.slice(0, -4).replace(/\d/g, '•') + p.slice(-4) : p);

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.ADMIN_TOKEN].filter(Boolean).some((t) => auth === `Bearer ${t}`);
  if (!ok) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const url = new URL(req.url, 'http://x');
  const dryRun = url.searchParams.get('dry_run') === '1';
  const results = await reviewAll({ limit: 20, dryRun });
  if (!dryRun) await followups.prune(); // old sent, closed and canceled follow-ups (lib/followups.js)
  return res.status(200).json({
    ok: true,
    dry_run: dryRun,
    reviewed: results.length,
    results: results.map((r) => ({ ...r, phone: mask(r.phone) })),
  });
};
