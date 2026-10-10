#!/usr/bin/env python3
"""Copy the official key symbols out of the TfL map's vector artwork.

Usage: python3 tools/extract_symbols.py map.svg assets/js/tfl-symbols.js

Each symbol is taken from TfL's own "Key to symbols" box, re-centred on (0, 0)
and written as SVG markup for assets/js/symbols.js to use.
"""
import json
import sys

import svgvec

# (name, centre x, centre y, half width, half height) in PDF points, read off the key box
ROWS = [
    ('step-free-train', 406.3, 1690.0, 10, 10),
    ('step-free-platform', 406.3, 1711.5, 10, 10),
    ('national-rail', 406.3, 1732.5, 10, 7),
    ('airport', 406.3, 1753.5, 10, 9),
    ('river-near', 406.3, 1780.5, 10, 10),
    ('river-far', 406.3, 1815.0, 10, 6),
    ('coach', 406.3, 1843.5, 17, 6),
]


def hexc(c):
    return '#%02x%02x%02x' % c


def main(svg_path, out_path):
    items = svgvec.load(svg_path)
    out = {}
    for name, cx, cy, hw, hh in ROWS:
        parts, xs, ys = [], [], []
        for it in items:
            for sub in it['subs']:
                pts = svgvec.flatten(sub, 4)
                bx = [p[0] for p in pts]; by = [p[1] for p in pts]
                if not bx:
                    continue
                if min(bx) < cx - hw - 1 or max(bx) > cx + hw + 1 or min(by) < cy - hh - 1 or max(by) > cy + hh + 1:
                    continue
                xs += bx; ys += by
                d = 'M%.2f,%.2f' % (sub['start'][0] - cx, sub['start'][1] - cy)
                for seg in sub['segs']:
                    if seg[0] == 'L':
                        d += 'L%.2f,%.2f' % (seg[2][0] - cx, seg[2][1] - cy)
                    else:
                        d += 'C' + ' '.join('%.2f,%.2f' % (p[0] - cx, p[1] - cy) for p in seg[2:])
                if sub['closed']:
                    d += 'Z'
                if it['fill']:
                    parts.append(f'<path d="{d}" fill="{hexc(it["fill"])}"/>')
                elif it['stroke']:
                    parts.append(f'<path d="{d}" fill="none" stroke="{hexc(it["stroke"])}" stroke-width="{it["width"]:.2f}"/>')
        if not parts:
            print('WARN nothing found for', name, file=sys.stderr)
            continue
        # recentre on the symbol's own bounding box
        ox, oy = (min(xs) + max(xs)) / 2 - cx, (min(ys) + max(ys)) / 2 - cy
        out[name] = {'svg': f'<g transform="translate({-ox:.2f},{-oy:.2f})">' + ''.join(parts) + '</g>',
                     'w': round(max(xs) - min(xs), 2), 'h': round(max(ys) - min(ys), 2)}
        print(name, len(parts), 'paths', out[name]['w'], 'x', out[name]['h'], file=sys.stderr)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('// Official map symbols copied from the TfL large print Tube map key (tools/extract_symbols.py).\n')
        f.write('window.TFL_SYMBOLS = ')
        json.dump(out, f, separators=(',', ':'))
        f.write(';\n')


if __name__ == '__main__':
    main(*sys.argv[1:3])
