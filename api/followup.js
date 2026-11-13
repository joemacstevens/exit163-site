// POST /api/followup — text approved follow-up answers ("I'll find out and text you back").
// Auth: header "Authorization: Bearer <ADMIN_TOKEN>".
// Body: {
//   "id": 12,          // optional: just this follow-up; without it, every approved one
//   "dry_run": true    // defaults to true; send with false
// }
// Sends only rows that were approved (scripts/followups.js approve <id>), only 8am-9pm NJ time,
// never to opted-out numbers, and never twice. Details: lib/followups.js sendApproved.
const { readBody } = require('../lib/http');
const { sendApproved } = require('../lib/followups');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const b = await readBody(req);
  const id = b.id == null || b.id === '' ? undefined : Number(b.id);
  if (id !== undefined && !Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'id must be a number' });
  try {
    const out = await sendApproved({ id, dryRun: b.dry_run !== false && b.dry_run !== 'false' });
    return res.status(out.ok ? 200 : 409).json(out);
  } catch (e) {
    console.error('followup send', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
