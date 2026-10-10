"""Minimal parser for the SVG that `pdftocairo -svg` writes for the TfL map.

Only what that file uses is supported: <path> elements with absolute M/L/C/Z
commands and an optional `transform="matrix(a,b,c,d,e,f)"`.
"""
import re

COLOR_RE = re.compile(r'rgb\(([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)%\)')


def parse_color(v):
    if not v:
        return None
    m = COLOR_RE.match(v)
    if not m:
        return None
    return tuple(round(float(x) * 2.55) for x in m.groups())


def parse_d(d):
    """Return list of subpaths; each subpath is a list of segments
    ('L', p0, p1) or ('C', p0, c1, c2, p1), plus a closed flag."""
    toks = re.findall(r'[MLCZ]|-?[\d.]+(?:e-?\d+)?', d)
    subs, cur, start, pos = [], None, None, None
    i = 0
    while i < len(toks):
        t = toks[i]
        if t == 'M':
            pos = (float(toks[i + 1]), float(toks[i + 2])); i += 3
            cur = {'segs': [], 'closed': False, 'start': pos}
            subs.append(cur); start = pos
        elif t == 'L':
            p = (float(toks[i + 1]), float(toks[i + 2])); i += 3
            cur['segs'].append(('L', pos, p)); pos = p
        elif t == 'C':
            c1 = (float(toks[i + 1]), float(toks[i + 2]))
            c2 = (float(toks[i + 3]), float(toks[i + 4]))
            p = (float(toks[i + 5]), float(toks[i + 6])); i += 7
            cur['segs'].append(('C', pos, c1, c2, p)); pos = p
        elif t == 'Z':
            i += 1
            if cur:
                cur['closed'] = True
                if pos != start:
                    cur['segs'].append(('L', pos, start))
                pos = start
        else:
            i += 1
    return subs


def apply(m, p):
    a, b, c, d, e, f = m
    return (a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f)


def flatten(sub, steps=8):
    """Polyline of a subpath (beziers sampled)."""
    pts = [sub['start']]
    for s in sub['segs']:
        if s[0] == 'L':
            pts.append(s[2])
        else:
            p0, c1, c2, p1 = s[1:]
            for k in range(1, steps + 1):
                t = k / steps
                mt = 1 - t
                x = mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p1[0]
                y = mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p1[1]
                pts.append((x, y))
    return pts


def load(path):
    """Yield dicts: fill, stroke (rgb tuples or None), width, subpaths (page coords)."""
    s = open(path, encoding='utf-8').read()
    body = s[s.index('</defs>'):]
    out = []
    for m in re.finditer(r'<path ([^>]*)/>', body):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        tr = attrs.get('transform')
        mat = (1, 0, 0, 1, 0, 0)
        if tr:
            mat = tuple(float(v) for v in re.findall(r'-?[\d.]+(?:e-?\d+)?', tr))
        subs = parse_d(attrs.get('d', ''))
        scale = (abs(mat[0] * mat[3] - mat[1] * mat[2])) ** 0.5
        for sub in subs:
            sub['start'] = apply(mat, sub['start'])
            sub['segs'] = [tuple([seg[0]] + [apply(mat, p) for p in seg[1:]]) for seg in sub['segs']]
        out.append({
            'fill': parse_color(attrs.get('fill')),
            'stroke': parse_color(attrs.get('stroke')),
            'width': float(attrs.get('stroke-width', 0)) * scale,
            'subs': subs,
        })
    return out
