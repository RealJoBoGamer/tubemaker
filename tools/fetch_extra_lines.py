#!/usr/bin/env python3
"""Fetch Thameslink, London Trams and the IFS Cloud Cable Car from the TfL API.

Usage: python3 tools/fetch_extra_lines.py tools/lines_extra.json

The journey planner's "full" map adds these lines to the template. Their stop
order comes from the TfL Unified API (/Line/{id}/Route/Sequence/all); the
template builder later keeps only the stops TfL actually draws on the map.
"""
import json
import os
import re
import sys
import time
import urllib.request

API = 'https://api.tfl.gov.uk'

EXTRA = {
    'thameslink': {'name': 'Thameslink', 'color': '#D66FAA', 'style': 'thameslink', 'group': ''},
    'tram': {'name': 'London Trams', 'color': '#6EC72E', 'style': 'double', 'group': ''},
    'london-cable-car': {'name': 'IFS Cloud Cable Car', 'color': '#E51636', 'style': 'cable', 'group': ''},
}

# TfL API name -> name used on the map (and by the template's existing stations)
ALIASES = {
    "London St Pancras International": "King's Cross St. Pancras",
    "St Pancras International": "King's Cross St. Pancras",
    "London King's Cross": "King's Cross St. Pancras",
    "London Blackfriars": "Blackfriars",
    "London Bridge": "London Bridge",
    "London Victoria": "Victoria",
    "Royal Docks": "Royal Docks",
    "Greenwich Peninsula": "Greenwich Peninsula",
}


def get(path):
    req = urllib.request.Request(API + path, headers={'User-Agent': 'TubeMaker template builder', 'Accept': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def clean(name):
    n = name.replace('’', "'")
    n = re.sub(r'^IFS Cloud\s+', '', n)
    n = re.sub(r'\s+(Rail Station|Tram Stop|DLR Station|Underground Station|Station)$', '', n)
    n = re.sub(r'\s+\((London|Kent|Surrey|Sussex|Herts|Beds)\)$', '', n)
    return ALIASES.get(n, n)


def main(out_path):
    out = {}
    for lid, meta in EXTRA.items():
        seq = get(f'/Line/{lid}/Route/Sequence/all')
        names = {}
        for sps in seq.get('stopPointSequences', []):
            for sp in sps.get('stopPoint', []):
                names[sp['id']] = sp['name']
                if sp.get('stationId'):
                    names.setdefault(sp['stationId'], sp['name'])
        branches, naptans = [], {}
        for route in seq.get('orderedLineRoutes', []):
            br = []
            for nid in route['naptanIds']:
                if nid not in names:
                    continue
                n = clean(names[nid])
                naptans.setdefault(n, [])
                if nid not in naptans[n]:
                    naptans[n].append(nid)
                if not br or br[-1] != n:
                    br.append(n)
            if len(br) > 1 and br not in branches and br[::-1] not in branches:
                branches.append(br)
        out[lid] = dict(meta, branches=branches, naptans=naptans)
        print(lid, len(branches), 'routes', len(naptans), 'stops', file=sys.stderr)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'lines_extra.json'))
