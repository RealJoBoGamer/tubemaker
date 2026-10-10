#!/usr/bin/env python3
"""Fetch official station data from the TfL Unified API (api.tfl.gov.uk).

Usage: python3 tools/fetch_tfl.py tools/tfl_stations.json

For every line in the template it downloads the line's stop points and keeps,
per station: NaPTAN id, official name, fare zone(s), modes (so National Rail
interchanges can be cross-checked) and the lines TfL says serve it. The
template builder merges this into assets/js/template-data.js and reports any
station on a line that TfL does not list (or vice versa).

An app key is optional for this volume of requests; set TFL_APP_KEY to use one.
"""
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from lines_data import LINES, DISPLAY  # noqa: E402

API = 'https://api.tfl.gov.uk'


def get(path):
    key = os.environ.get('TFL_APP_KEY')
    url = API + path + (('&' if '?' in path else '?') + 'app_key=' + key if key else '')
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'TubeMaker template builder', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry network hiccups
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


SUFFIX = re.compile(r"\s+(Underground|DLR|Rail|Elizabeth line|London Overground)?\s*Station$|\s+\(.*?\)$", re.I)


def norm(name):
    n = name.replace('\u2019', "'").replace("'", '').replace('St. ', 'St ').replace(' & ', ' and ')
    n = SUFFIX.sub('', n).strip()
    n = re.sub(r'^London (?=Euston|Liverpool Street)', '', n)
    n = re.sub(r'\s+ELL$', '', n)
    return re.sub(r'[^a-z0-9]+', ' ', n.lower()).strip()


def main(out_path):
    stations = {}
    per_line = {}
    for lid in LINES:
        stops = get(f'/Line/{lid}/StopPoints')
        per_line[lid] = []
        for sp in stops:
            name = sp.get('commonName', '')
            zone = next((p.get('value') for p in sp.get('additionalProperties', []) if p.get('key') == 'Zone'), None)
            rec = stations.setdefault(sp['naptanId'], {
                'naptan': sp['naptanId'], 'name': SUFFIX.sub('', name).strip(), 'zone': zone,
                'modes': sorted(sp.get('modes', [])), 'lines': sorted(l['id'] for l in sp.get('lines', [])),
                'lat': sp.get('lat'), 'lon': sp.get('lon'),
            })
            per_line[lid].append(sp['naptanId'])
            if zone and not rec['zone']:
                rec['zone'] = zone
        print(lid, len(stops), 'stops', file=sys.stderr)
    # match TfL stop points to our station ids, line by line
    matches, report = {}, []
    for lid, l in LINES.items():
        ours = {s for br in l['branches'] for s in br}
        theirs = {norm(stations[n]['name']): n for n in per_line[lid]}
        found = set()
        for s in ours:
            key = norm(DISPLAY.get(s, s))
            n = theirs.get(key)
            if not n:  # e.g. "Heathrow Terminals 2 & 3" vs "Heathrow Terminals 2 & 3 Underground Station"
                cands = [k for k in theirs if k.startswith(key) or key.startswith(k)]
                n = theirs[cands[0]] if len(cands) == 1 else None
            if n:
                found.add(n)
                # prefer the Tube station record (940G...) when a station has several
                if s not in matches or (n.startswith('940G') and not matches[s].startswith('940G')):
                    matches[s] = n
            else:
                report.append(f'{lid}: "{s}" not found in TfL stop list')
        for k, n in theirs.items():
            if n not in found:
                report.append(f'{lid}: TfL lists "{stations[n]["name"]}" which the template does not')
    out = {'fetched': time.strftime('%Y-%m-%d'), 'source': API, 'stations': {s: stations[n] for s, n in matches.items()},
           'report': report}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f'{len(matches)} stations matched', file=sys.stderr)
    for r in report:
        print('NOTE', r, file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'tfl_stations.json'))
