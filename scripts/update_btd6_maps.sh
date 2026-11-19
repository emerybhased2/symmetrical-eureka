#!/usr/bin/env bash
# Refresh the bundled BTD6 map reference from the public sources.
# Usage: scripts/update_btd6_maps.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I scripts/fetch_btd6_maps.py --output extracted/bloons-td--demo-v/btd6_maps.json
python3 -I -c "
import json
d = json.load(open('extracted/bloons-td--demo-v/btd6_maps.json'))
print(f\"wrote extracted/bloons-td--demo-v/btd6_maps.json ({d['count']} maps)\")
for s in d['sources']:
    mark = 'ok' if s.get('ok') else 'FAIL'
    print(f\"  {s['key']:12s} {mark} count={s.get('count','-')}\")"
