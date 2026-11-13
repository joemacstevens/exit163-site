#!/usr/bin/env python3
"""Merge research/sources/<domain>.json into research/sources/REGISTRY.json and REGISTRY.md.
   python3 scripts/build-registry.py
Each source keeps its scout fields and gains: id, domain, last_checked (null until a harvest sets it)."""
import json, glob, os, re, collections
root = os.path.join(os.path.dirname(__file__), '..', 'research', 'sources')
prev = {}
reg_path = os.path.join(root, 'REGISTRY.json')
if os.path.exists(reg_path):
    prev = {s['id']: s for s in json.load(open(reg_path))['sources']}
out, recipes, seen = [], [], {}
for f in sorted(glob.glob(os.path.join(root, '*.json'))):
    if os.path.basename(f) == 'REGISTRY.json': continue
    d = json.load(open(f)); dom = d.get('domain') or os.path.basename(f)[:-5]
    for r in d.get('search_recipes', []): recipes.append({'domain': dom, 'recipe': r})
    for s in d.get('sources', []):
        url = (s.get('url') or '').strip()
        key = re.sub(r'^https?://(www\.)?', '', url).rstrip('/').lower()
        if not key: continue
        if key in seen:  # same page found by two scouts: keep the first, note the other domain
            o = seen[key]; o['domains'] = sorted(set(o['domains'] + [dom]))
            o['categories'] = sorted(set((o.get('categories') or []) + (s.get('categories') or [])))
            continue
        sid = re.sub(r'[^a-z0-9]+', '-', (s.get('name') or key).lower()).strip('-')[:60]
        n, base = 2, sid
        while any(x['id'] == sid for x in out): sid = f'{base}-{n}'; n += 1
        e = {'id': sid, 'domains': [dom], **s}
        e['last_checked'] = prev.get(sid, {}).get('last_checked')
        e['last_yield'] = prev.get(sid, {}).get('last_yield')
        seen[key] = e; out.append(e)
rank = {'high': 0, 'medium': 1, 'low': 2}
out.sort(key=lambda s: (rank.get(s.get('yield'), 3), s['domains'][0], s['name']))
json.dump({'built': '2026-11-12', 'count': len(out), 'sources': out, 'search_recipes': recipes}, open(reg_path, 'w'), indent=1)

C = collections.Counter
md = ['# Exit 163 source registry', '', f'{len(out)} sources we re-check for Bergen County events. Built by `scripts/build-registry.py` from the scout files in this folder; edit those, then rebuild.', '']
md += ['| | count |', '|---|---|']
for label, c in [('By domain', C(d for s in out for d in s['domains'])), ('By access', C(s.get('access') for s in out)), ('By yield', C(s.get('yield') for s in out)), ('By re-check cadence', C(s.get('cadence') for s in out))]:
    md.append(f"| **{label}** | {', '.join(f'{k} {v}' for k, v in c.most_common())} |")
md += ['', '## High-yield sources', '', '| source | kind | towns | access | cadence | page to re-check |', '|---|---|---|---|---|---|']
for s in out:
    if s.get('yield') != 'high': continue
    towns = ', '.join((s.get('towns') or [])[:3]) + ('…' if len(s.get('towns') or []) > 3 else '')
    md.append(f"| {s['name']} | {s.get('kind')} | {towns} | {s.get('access')} | {s.get('cadence')} | {s.get('url')} |")
md += ['', '## Needs a logged-in Facebook or Instagram session', '', 'These cannot be read by a plain fetch. They are the queue for the phone agent (Muse) or a signed-in browser pass.', '', '| source | kind | towns | what it posts | page |', '|---|---|---|---|---|']
for s in out:
    if s.get('access') != 'login_required': continue
    md.append(f"| {s['name']} | {s.get('kind')} | {', '.join((s.get('towns') or [])[:3])} | {', '.join((s.get('event_types') or [])[:3])} | {s.get('url')} |")
open(os.path.join(root, 'REGISTRY.md'), 'w').write('\n'.join(md) + '\n')
print(len(out), 'sources;', dict(C(s.get('access') for s in out)), dict(C(s.get('yield') for s in out)), dict(C(s.get('cadence') for s in out)))
