// Run the memory review by hand.
//   node --env-file=.env.local scripts/reflect.js --dry-run        # show what would change
//   node --env-file=.env.local scripts/reflect.js                  # apply
//   node --env-file=.env.local scripts/reflect.js --phone +1201...  # just one person
const { reviewAll } = require('../lib/reflect');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const phoneIdx = args.indexOf('--phone');
const phones = phoneIdx >= 0 ? [args[phoneIdx + 1]] : undefined;
const mask = (p) => p.slice(0, -4).replace(/\d/g, '•') + p.slice(-4);

reviewAll({ limit: 200, dryRun, phones }).then((results) => {
  for (const r of results) {
    if (r.skipped || r.error) { console.log(`${mask(r.phone)}  ${r.skipped || 'ERROR ' + r.error}`); continue; }
    console.log(`${mask(r.phone)}  ${r.why}`);
    for (const a of r.add || []) console.log(`   + ${a.kind}: ${a.fact}${a.kid_age != null ? ` (age ${a.kid_age})` : ''}`);
    for (const id of r.remove || []) console.log(`   - fact #${id}`);
  }
  console.log(`${results.length} reviewed${dryRun ? ' (dry run, nothing saved)' : ''}`);
}).catch((e) => { console.error(e); process.exit(1); });
