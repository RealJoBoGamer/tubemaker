#!/usr/bin/env python3
"""Build assets/js/template-data.js from the TfL large print Tube map (vector).

Usage:
  pdftotext -f 1 -l 1 -bbox large-print-tube-map.pdf words.html
  pdftocairo -f 1 -l 1 -svg large-print-tube-map.pdf map.svg
  python3 tools/build_template.py words.html map.svg assets/js/template-data.js

How it works
  * Each line colour's own vector shapes (TfL draws most track as filled
    outlines) are rendered alone at 4x and thinned to an exact centreline.
  * Station labels are found in the PDF text layer (keeping TfL's wrapping);
    the station sits where all its lines meet next to the label, snapped to
    TfL's own marker: interchange circle, step-free icon or tick.
  * Every line's own centreline is traced between consecutive stations and
    rebuilt as exact 0/45/90-degree segments, so parallel lines keep TfL's
    spacing. The River Thames, fare-zone shading and zone numbers are copied
    from the vector artwork.
"""
import html
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree
from skimage.graph import route_through_array
from skimage.morphology import skeletonize

sys.path.insert(0, os.path.dirname(__file__))
import svgvec  # noqa: E402
from lines_data import (LINES, DISPLAY, SEARCH, AIRPORT, RIVER, COACH)  # noqa: E402

# Exact fill/stroke colours of each line in the PDF artwork.
VEC_COLOURS = {
    'bakerloo': (174, 83, 14), 'central': (238, 39, 34), 'circle': (252, 208, 6), 'district': (10, 129, 55),
    'hammersmith-city': (244, 104, 161), 'jubilee': (148, 152, 154), 'metropolitan': (150, 1, 84),
    'northern': (35, 31, 32), 'piccadilly': (38, 61, 150), 'victoria': (45, 158, 223),
    'waterloo-city': (135, 213, 180), 'dlr': (33, 181, 176), 'elizabeth': (92, 66, 163), 'liberty': (79, 93, 98),
    'lioness': (248, 156, 14), 'mildmay': (36, 134, 203), 'suffragette': (89, 195, 100), 'weaver': (176, 35, 127),
    'windrush': (237, 25, 46),
    # extra lines for the journey planner's full map
    'thameslink': (214, 111, 170), 'tram': (110, 199, 46), 'london-cable-car': (229, 22, 54),
}
FULL = os.environ.get('TUBEMAKER_FULL') == '1'
NAVY = (38, 61, 150)
WHITE = (255, 255, 255)
RED = (238, 39, 34)

# Crop of the PDF page that holds the map itself (points); output coordinates are relative to it.
MAP_X0, MAP_Y0, MAP_X1, MAP_Y1 = 340, 250, 2790, 1975
SCALE = 4  # raster scale used for centreline extraction


def log(*a):
    print(*a, file=sys.stderr)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", "and")).strip("-")


def in_map(x, y):
    return MAP_X0 <= x <= MAP_X1 and MAP_Y0 <= y <= MAP_Y1


# ------------------------------------------------------------------ text layer

def norm(w):
    w = html.unescape(w).replace("’", "'").lower()
    return re.sub(r"[^a-z0-9&'()-]", "", w)


def load_words(path):
    s = open(path, encoding="utf-8").read()
    out = []
    for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', s):
        x0, y0, x1, y1 = map(float, m.groups()[:4])
        raw = html.unescape(m.group(5)).replace("’", "'")
        out.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "n": norm(m.group(5)), "raw": raw})
    return out


def find_label(words, name):
    """All chains of words (same line or wrapped) spelling `name`."""
    joined = norm(name.replace(" ", ""))
    cands = []
    for i, w in enumerate(words):
        if not in_map(w["x0"], w["y0"]):
            continue
        acc = w["n"]
        if not joined.startswith(acc):
            continue
        chain, cur = [i], w
        while acc != joined:
            best = None
            for j, v in enumerate(words):
                if j in chain or not joined.startswith(acc + v["n"]):
                    continue
                first = words[chain[0]]
                same = abs(v["y0"] - cur["y0"]) < 3 and 0 <= v["x0"] - cur["x1"] <= 14
                # wrapped label lines are left-, right- or centre-aligned with the line above
                line_x0 = min(words[k]["x0"] for k in chain if abs(words[k]["y0"] - cur["y0"]) < 3)
                line_x1 = max(words[k]["x1"] for k in chain if abs(words[k]["y0"] - cur["y0"]) < 3)
                nxt = 7 < v["y0"] - cur["y0"] < 17 and (
                    line_x0 - 30 <= v["x0"] <= line_x1 or abs(v["x1"] - line_x1) < 5 or
                    (v["x0"] < line_x0 and v["x1"] > line_x0))
                if same or nxt:
                    d = abs(v["y0"] - cur["y0"]) + abs(v["x0"] - cur["x1"]) * 0.1
                    if best is None or d < best[0]:
                        best = (d, j)
            if best is None:
                break
            chain.append(best[1])
            acc += words[best[1]]["n"]
            cur = words[best[1]]
        if acc == joined:
            cands.append(chain)
    return cands


def label_lines(words, chain):
    lines = []
    for idx in chain:
        w = words[idx]
        if lines and abs(lines[-1]["y0"] - w["y0"]) < 3:
            sep = "" if lines[-1]["text"].endswith("-") else " "
            lines[-1]["text"] += sep + w["raw"]
            lines[-1]["x1"] = w["x1"]
        else:
            lines.append({"text": w["raw"], "x0": w["x0"], "x1": w["x1"], "y0": w["y0"], "y1": w["y1"]})
    return lines


def glyph_baselines(svg_text):
    """(x, y) origins of every navy glyph: y is the text baseline."""
    pts = []
    for m in re.finditer(r'<g fill="rgb\(15\.080261%, 23\.83728%, 58\.665466%\)"[^>]*>\s*<use xlink:href="#[^"]+" x="([-\d.]+)" y="([-\d.]+)"', svg_text):
        pts.append((float(m.group(1)), float(m.group(2))))
    return np.array(pts)


# ------------------------------------------------------------- vector artwork

def flat(sub, steps=6):
    return svgvec.flatten(sub, steps)


def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


class LineGeom:
    """Centreline of one line colour, extracted from its vector shapes."""

    def __init__(self, lid, items):
        cache = os.environ.get('TUBEMAKER_CACHE')
        cpath = cache and os.path.join(cache, f'geom-{lid}.npz')
        if cpath and os.path.exists(cpath):
            z = np.load(cpath, allow_pickle=True)
            self.x0, self.y0 = int(z['x0']), int(z['y0'])
            self.mask, self.skel = z['mask'], z['skel']
            self.ticks = [tuple(t) for t in z['ticks']]
            self._finish()
            return
        self._build(lid, items)
        if cpath:
            os.makedirs(cache, exist_ok=True)
            np.savez_compressed(cpath, x0=self.x0, y0=self.y0, mask=self.mask, skel=self.skel, ticks=np.array(self.ticks))

    def _finish(self):
        sk = np.argwhere(self.skel)
        self.sk_page = np.stack([sk[:, 1] / SCALE + self.x0, sk[:, 0] / SCALE + self.y0], axis=1)
        self.tree = cKDTree(self.sk_page)

    def _build(self, lid, items):
        col = VEC_COLOURS[lid]
        polys, strokes, ticks = [], [], []
        for it in items:
            if it['fill'] == col:
                for sub in it['subs']:
                    pts = flat(sub)
                    x0, y0, x1, y1 = bbox(pts)
                    if x0 > MAP_X1:
                        continue
                    w, h = x1 - x0, y1 - y0
                    big, small = max(w, h), min(w, h)
                    kinds = set(s[0] for s in sub['segs'])
                    # ticks (about 4 x 7) and end-of-line bars (about 4 x 14)
                    if kinds == {'L'} and len(sub['segs']) == 4 and big >= 5.6 and (big < 10 or (big < 17 and small < 5.5)):
                        ticks.append(((x0 + x1) / 2, (y0 + y1) / 2))
                    if big >= 30 or (big >= 12 and small / max(big, 1e-6) < 0.5 and small < 7):
                        polys.append(pts)
            if it['stroke'] == col and 3 < it['width'] < 7:
                for sub in it['subs']:
                    pts = flat(sub)
                    if bbox(pts)[0] > MAP_X1:
                        continue
                    strokes.append((pts, it['width']))
        allpts = [p for pl in polys for p in pl] + [p for pl, w in strokes for p in pl]
        self.x0 = int(min(p[0] for p in allpts)) - 20
        self.y0 = int(min(p[1] for p in allpts)) - 20
        x1 = int(max(p[0] for p in allpts)) + 20
        y1 = int(max(p[1] for p in allpts)) + 20
        img = Image.new('L', ((x1 - self.x0) * SCALE, (y1 - self.y0) * SCALE), 0)
        dr = ImageDraw.Draw(img)
        tf = lambda p: ((p[0] - self.x0) * SCALE, (p[1] - self.y0) * SCALE)
        for pl in polys:
            dr.polygon([tf(p) for p in pl], fill=255)
        for pl, w in strokes:
            dr.line([tf(p) for p in pl], fill=255, width=max(1, int(round(w * SCALE))), joint='curve')
        self.mask = np.asarray(img) > 127
        self.skel = skeletonize(self.mask)
        self.ticks = ticks
        self._finish()

    def dist(self, pts):
        d, _ = self.tree.query(pts)
        return d

    def nearest(self, p):
        d, i = self.tree.query(p)
        return self.sk_page[i], d

    def route(self, pa, pb, margin=60):
        """Centreline from pa to pb (both on the skeleton), in page coords."""
        def rc(p):
            return (int(round((p[1] - self.y0) * SCALE)), int(round((p[0] - self.x0) * SCALE)))
        ra, rb = rc(pa), rc(pb)
        m = margin * SCALE
        H, W = self.mask.shape
        r0 = max(min(ra[0], rb[0]) - m, 0); r1 = min(max(ra[0], rb[0]) + m, H - 1)
        c0 = max(min(ra[1], rb[1]) - m, 0); c1 = min(max(ra[1], rb[1]) + m, W - 1)
        sk = self.skel[r0:r1 + 1, c0:c1 + 1]; mk = self.mask[r0:r1 + 1, c0:c1 + 1]
        sub = np.where(sk, 1.0, np.where(mk, 6.0, 80.0)).astype(np.float32)
        path, total = route_through_array(sub, (ra[0] - r0, ra[1] - c0), (rb[0] - r0, rb[1] - c0),
                                          fully_connected=True, geometric=True)
        path = np.array(path, float)
        length = np.sum(np.hypot(*np.diff(path, axis=0).T)) if len(path) > 1 else 0
        pts = np.stack([(path[:, 1] + c0) / SCALE + self.x0, (path[:, 0] + r0) / SCALE + self.y0], axis=1)
        return pts, (total / length if length else 1.0)


def arc_centre(seg):
    """Centre and radius of the circle through a cubic bezier's start, middle and end."""
    p0, c1, c2, p1 = seg[1:]
    m = (0.125 * p0[0] + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * p1[0],
         0.125 * p0[1] + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * p1[1])
    ax, ay = p0; bx, by = m; cx, cy = p1
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return (ux, uy), math.hypot(ax - ux, ay - uy)


def find_markers(items):
    """Station markers drawn by TfL, recognised from the circular arcs around a point:
      interchange circle  - black ring (r 5.5..8.5) around a white disc (r 7.0);
                            also inside complexes where circles and bars share one outline
      step-free platform  - navy ring (r 8.5) around a white disc (r 7.5)
      step-free train     - solid navy disc (r 8.5)"""
    BLACK = (35, 31, 32)
    arcs = []
    for it in items:
        col = it['fill']
        if col not in (WHITE, NAVY, BLACK):
            continue
        for sub in it['subs']:
            for seg in sub['segs']:
                if seg[0] != 'C':
                    continue
                ac = arc_centre(seg)
                if ac and in_map(*ac[0]) and 4.8 < ac[1] < 9.4:
                    arcs.append((ac[0], ac[1], col))
    pts = np.array([a[0] for a in arcs])
    tree = cKDTree(pts)
    seen, markers = set(), []
    for i in range(len(arcs)):
        if i in seen:
            continue
        grp = [j for j in tree.query_ball_point(pts[i], 1.6) if j not in seen]
        seen.update(grp)
        has = lambda col, lo, hi: any(arcs[j][2] == col and lo <= arcs[j][1] <= hi for j in grp)
        # step-free icons win: inside a complex they also carry the black outline
        if has(NAVY, 8.0, 9.3) and has(WHITE, 7.2, 8.2):
            kind = 'platform'
        elif has(NAVY, 8.0, 9.3):
            kind = 'train'
        elif has(BLACK, 8.0, 9.3) and (has(BLACK, 5.0, 6.3) or has(WHITE, 6.6, 7.3)):
            kind = 'interchange'
        else:
            continue
        markers.append({'c': tuple(np.mean(pts[grp], axis=0)), 'r': 8.6, 'kind': kind})
    out = []
    for m in markers:
        if all(math.hypot(m['c'][0] - o['c'][0], m['c'][1] - o['c'][1]) > 4 for o in out):
            out.append(m)
    return out


def black_outline_index(items):
    """Flattened black fill subpaths (interchange rings and complex outlines)."""
    polys = []
    for it in items:
        if it['fill'] != (35, 31, 32):
            continue
        rings = [np.array(flat(sub, 6)) for sub in it['subs'] if len(sub['segs']) > 2]
        if rings:
            allp = np.vstack(rings)
            polys.append((allp.min(axis=0), allp.max(axis=0), rings))
    return polys


def inside_black(polys, p):
    """True when p lies on a black outline shape (even-odd over its subpaths)."""
    x, y = p
    for lo, hi, rings in polys:
        if not (lo[0] <= x <= hi[0] and lo[1] <= y <= hi[1]):
            continue
        cnt = 0
        for r in rings:
            xs, ys = r[:, 0], r[:, 1]
            xs2, ys2 = np.roll(xs, -1), np.roll(ys, -1)
            cond = (ys > y) != (ys2 > y)
            with np.errstate(divide='ignore', invalid='ignore'):
                xi = xs + (y - ys) * (xs2 - xs) / (ys2 - ys)
            cnt += int(np.sum(cond & (x < xi)))
        if cnt % 2 == 1:
            return True
    return False


def joined(polys, a, b):
    """Are two markers joined by a bar (part of one outline)? Sample along the gap."""
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    if d < 1:
        return True
    ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
    # the bar's black edges run either side of the centre line, ~3.5 out
    nx, ny = -uy, ux
    hits = 0
    samples = [t for t in np.linspace(9.5, d - 9.5, 5)] if d > 22 else [d / 2]
    for t in samples:
        cx, cy = a[0] + ux * t, a[1] + uy * t
        # a bar has black edges on both sides of a white centre
        if inside_black(polys, (cx + nx * 3.6, cy + ny * 3.6)) and inside_black(polys, (cx - nx * 3.6, cy - ny * 3.6)):
            hits += 1
    return hits >= max(1, len(samples) - 1)


def find_dots(items):
    """Centres of the little black squares that make up dotted walking links."""
    out = []
    for it in items:
        if it['fill'] != (35, 31, 32):
            continue
        for sub in it['subs']:
            if len(sub['segs']) == 4 and all(sg[0] == 'L' for sg in sub['segs']):
                x0, y0, x1, y1 = bbox(flat(sub))
                if max(x1 - x0, y1 - y0) < 5.5 and in_map(x0, y0):
                    out.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return out


def dot_chains(dots, gap=7.5):
    """Group dots into chains; return the two far ends of every chain."""
    if not dots:
        return []
    pts = np.array(dots)
    tree = cKDTree(pts)
    parent = list(range(len(pts)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in tree.query_pairs(gap):
        parent[find(i)] = find(j)
    groups = {}
    for i in range(len(pts)):
        groups.setdefault(find(i), []).append(i)
    ends = []
    for g in groups.values():
        if len(g) < 2:
            continue
        P = pts[g]
        d = np.hypot(*(P[:, None, :] - P[None, :, :]).transpose(2, 0, 1))
        a, b = np.unravel_index(int(np.argmax(d)), d.shape)
        ends.append((tuple(P[a]), tuple(P[b])))
    return ends


# Navy pictograms recognised by the segment counts of their sub-shapes (as in TfL's key).
ICON_SIGS = {
    (28, 0): 'airport',
    (4, 6, 4, 6, 11, 24): 'boat',
    (6, 4, 4, 6, 29): 'coach',
}


def find_icons(items):
    """Airport, riverboat and coach pictograms on the map: (kind, centre, width)."""
    out = []
    for it in items:
        if it['fill'] != NAVY or not it['subs']:
            continue
        kind = ICON_SIGS.get(tuple(len(sub['segs']) for sub in it['subs']))
        if not kind:
            continue
        pts = [p for sub in it['subs'] for p in flat(sub, 3)]
        x0, y0, x1, y1 = bbox(pts)
        if in_map(x0, y0):
            out.append((kind, ((x0 + x1) / 2, (y0 + y1) / 2), x1 - x0))
    return out


def find_rail_symbols(items):
    pts = []
    for it in items:
        if it['fill'] != RED:
            continue
        for sub in it['subs']:
            if len(sub['segs']) == 20 and all(s[0] == 'L' for s in sub['segs']):
                x0, y0, x1, y1 = bbox(flat(sub))
                if 10 < x1 - x0 < 17 and in_map(x0, y0):
                    pts.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return pts


def fills_of(items, col, min_size=0):
    """Filled shapes of one colour; each shape is a list of rings (even-odd)."""
    out = []
    for it in items:
        if it['fill'] != col:
            continue
        rings = []
        for sub in it['subs']:
            pts = flat(sub, 8)
            x0, y0, x1, y1 = bbox(pts)
            if x0 > MAP_X1 + 150 or max(x1 - x0, y1 - y0) < min_size:
                continue
            rings.append(pts)
        if rings:
            out.append(rings)
    return out


# --------------------------------------------------------------- geometry

DIRS = [(math.cos(i * math.pi / 4), math.sin(i * math.pi / 4)) for i in range(8)]


def octi_dev(dx, dy):
    deg = abs(math.degrees(math.atan2(dy, dx))) % 45
    return min(deg, 45 - deg)


def seg_dist(p, a, b):
    a = np.asarray(a, float); b = np.asarray(b, float); p = np.asarray(p, float)
    ab = b - a
    t = 0 if not ab.any() else np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1)
    return float(np.hypot(*(p - (a + t * ab))))


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    d = np.array([seg_dist(p, a, b) for p in pts])
    k = int(np.argmax(d))
    if d[k] > eps:
        return np.vstack([rdp(pts[:k + 1], eps)[:-1], rdp(pts[k:], eps)])
    return np.vstack([a, b])


def intersect(p, u, q, v):
    det = u[0] * -v[1] - u[1] * -v[0]
    if abs(det) < 1e-9:
        return None
    t = ((q[0] - p[0]) * -v[1] - (q[1] - p[1]) * -v[0]) / det
    return (p[0] + u[0] * t, p[1] + u[1] * t)


def snap_end(pts, i, P):
    """Move a path end onto the marker centre when it lies on the end segment's line."""
    a = pts[i]
    b = pts[1] if i == 0 else pts[-2]
    if math.hypot(a[0] - P[0], a[1] - P[1]) < 0.01:
        return a
    u = (a[0] - b[0], a[1] - b[1]); L = math.hypot(*u) or 1
    u = (u[0] / L, u[1] / L)
    # perpendicular distance of P from the end segment's line
    perp = abs((P[0] - b[0]) * u[1] - (P[1] - b[1]) * u[0])
    return tuple(P) if perp < 1.0 else a


def octilinear_path(pts, end_snap=1.5):
    """Rebuild a traced centreline as exact 0/45/90-degree segments with sharp corners
    (the renderer rounds them again)."""
    simp = rdp(np.asarray(pts, float), 0.45)
    runs = []  # (point on line, unit direction, start, end)
    for a, b in zip(simp[:-1], simp[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 2.5 or octi_dev(dx, dy) > 6:
            continue  # part of a rounded corner
        u = max(DIRS, key=lambda d: d[0] * dx + d[1] * dy)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if runs and runs[-1][1] == u and seg_dist(mid, runs[-1][0], (runs[-1][0][0] + u[0], runs[-1][0][1] + u[1])) < 1.2:
            r = runs[-1]
            # merge collinear pieces; weight the anchor by length
            w0 = r[4]
            m = ((r[0][0] * w0 + mid[0] * L) / (w0 + L), (r[0][1] * w0 + mid[1] * L) / (w0 + L))
            runs[-1] = (m, u, r[2], b, w0 + L)
        else:
            runs.append((mid, u, a, b, L))
    start, end = tuple(pts[0]), tuple(pts[-1])
    if not runs:
        return [start, end]
    out = [start]
    for r1, r2 in zip(runs[:-1], runs[1:]):
        x = intersect(r1[0], r1[1], r2[0], r2[1])
        if x is None or math.hypot(x[0] - r1[3][0], x[1] - r1[3][1]) > 40:
            out.extend([tuple(r1[3]), tuple(r2[2])])
        else:
            out.append(x)
    out.append(end)
    # snap the end points onto their runs so the first/last segment is exact
    def proj(p, r):
        u = r[1]
        t = (p[0] - r[0][0]) * u[0] + (p[1] - r[0][1]) * u[1]
        return (r[0][0] + u[0] * t, r[0][1] + u[1] * t)
    if math.hypot(*np.subtract(proj(start, runs[0]), start)) < end_snap:
        out[0] = proj(start, runs[0])
    if math.hypot(*np.subtract(proj(end, runs[-1]), end)) < end_snap:
        out[-1] = proj(end, runs[-1])
    # drop zero-length / collinear points
    clean = [out[0]]
    for i in range(1, len(out) - 1):
        a, b, c = clean[-1], out[i], out[i + 1]
        if math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3:
            continue
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) < 0.05 * max(1, math.hypot(b[0] - a[0], b[1] - a[1])):
            continue
        clean.append(b)
    clean.append(out[-1])
    return clean


# ------------------------------------------------------------------ main

def tfl_info(sid, tfl):
    """NaPTAN ids (all of them, for journey matching) and fare zone of a station."""
    ids, zone = [], None
    if sid in tfl:
        ids += tfl[sid].get('naptans') or [tfl[sid]['naptan']]
        zone = tfl[sid]['zone']
    for lid, l in LINES.items():
        for n in l.get('naptans', {}).get(sid, []):
            if n not in ids:
                ids.append(n)
    if not ids and not zone:
        return None
    return {'naptan': ids[0] if ids else '', 'naptans': ids, 'zone': zone}


def add_extra_lines(extra, geoms, words):
    """Add the extra lines to LINES, keeping only stops TfL draws on this map:
    the station's label must sit next to that line's own artwork."""
    towards = [w for w in words if w['n'] == 'towards' and in_map(w['x0'], w['y0'])]
    def on_map(name, lid):
        for chain in find_label(words, SEARCH.get(name, DISPLAY.get(name, name))):
            ls = label_lines(words, chain)
            bx0 = min(l['x0'] for l in ls); bx1 = max(l['x1'] for l in ls)
            by0 = min(l['y0'] for l in ls); by1 = max(l['y1'] for l in ls)
            if any(abs(t['x0'] - bx0) < 60 and -30 < by0 - t['y0'] < 50 for t in towards):
                continue  # part of a "Towards ..." arrow, not a station
            corners = [(bx0, by0), (bx1, by0), (bx0, by1), (bx1, by1), ((bx0 + bx1) / 2, (by0 + by1) / 2)]
            if min(geoms[lid].dist(corners)) < 45:
                return True
        return False
    for lid, meta in extra.items():
        cache = {}
        branches = []
        for br in meta['branches']:
            kept = []
            for n in br:
                if n not in cache:
                    cache[n] = on_map(n, lid)
                if cache[n] and (not kept or kept[-1] != n):
                    kept.append(n)
            if len(kept) < 2:
                continue
            key = '>'.join(kept)
            # drop branches contained in another (express services skip stops)
            if any(key in '>'.join(b) or key in '>'.join(b[::-1]) for b in branches):
                continue
            branches = [b for b in branches if '>'.join(b) not in key and '>'.join(b[::-1]) not in key]
            branches.append(kept)
        LINES[lid] = {'name': meta['name'], 'color': meta['color'], 'style': meta['style'], 'group': meta.get('group', ''),
                      'branches': branches, 'naptans': meta.get('naptans', {})}
        log(f"{lid}: {len(branches)} branches, {len({s for b in branches for s in b})} stations on the map")


def main(words_path, svg_path, out_path):
    svg_text = open(svg_path, encoding='utf-8').read()
    items = svgvec.load(svg_path)
    words = load_words(words_path)
    baselines = glyph_baselines(svg_text)
    base_tree = cKDTree(baselines)

    log('extracting centrelines…')
    extra = {}
    if FULL:
        # Thameslink, Trams and the Cable Car (stop order from the TfL API, tools/fetch_extra_lines.py)
        extra = json.load(open(os.path.join(os.path.dirname(__file__), 'lines_extra.json'), encoding='utf-8'))
    geoms = {lid: LineGeom(lid, items) for lid in list(LINES) + list(extra)}
    if extra:
        add_extra_lines(extra, geoms, words)
    markers = find_markers(items)
    mk_tree = cKDTree([m['c'] for m in markers])
    rail = find_rail_symbols(items)
    icons = find_icons(items)
    # a riverboat inside a ring is a pier, not a step-free icon
    boats = [c for k, c, w in icons if k == 'boat']
    for m in markers:
        if any(math.hypot(m['c'][0] - b[0], m['c'][1] - b[1]) < 4 for b in boats):
            m['kind'] = 'pier'
    log(f"{sum(1 for m in markers if m['kind'] == 'pier')} piers, {len(icons)} pictograms")
    black = black_outline_index(items)
    rail_tree = cKDTree(rail) if rail else None
    log(f'{len(markers)} markers, {len(rail)} National Rail symbols')

    station_lines = {}
    for lid, l in LINES.items():
        for br in l['branches']:
            for s in br:
                station_lines.setdefault(s, [])
                if lid not in station_lines[s]:
                    station_lines[s].append(lid)

    used_words, used_markers, used_ticks, used_rail, used_icons = set(), set(), set(), set(), set()
    stations, problems = {}, []
    order = sorted(station_lines.items(), key=lambda kv: -len(SEARCH.get(kv[0], DISPLAY.get(kv[0], kv[0]))))
    for sid, lids in order:
        name = SEARCH.get(sid, DISPLAY.get(sid, sid))
        cands = find_label(words, name)
        if not cands:
            problems.append(f'no label: {sid}')
            continue
        best = None
        for chain in cands:
            ls = label_lines(words, chain)
            bx0 = min(l['x0'] for l in ls); bx1 = max(l['x1'] for l in ls)
            by0 = min(l['y0'] for l in ls); by1 = max(l['y1'] for l in ls)
            # grid search: point near the label where all of the station's lines meet
            xs = np.arange(bx0 - 70, bx1 + 70, 1.0); ys = np.arange(by0 - 70, by1 + 70, 1.0)
            gx, gy = np.meshgrid(xs, ys)
            P = np.stack([gx.ravel(), gy.ravel()], axis=1)
            ddx = np.maximum(np.maximum(bx0 - P[:, 0], 0), P[:, 0] - bx1)
            ddy = np.maximum(np.maximum(by0 - P[:, 1], 0), P[:, 1] - by1)
            cost = 0.35 * np.hypot(ddx, ddy)
            for lid in lids:
                cost = cost + np.minimum(geoms[lid].dist(P), 60)
            if used_words & set(chain):
                cost = cost + 1000
            k = int(np.argmin(cost))
            if best is None or cost[k] < best[0]:
                best = (cost[k], chain, ls, P[k], (bx0, by0, bx1, by1))
        score, chain, ls, est, lb = best
        used_words.update(chain)
        if score > 120:
            problems.append(f'far ({score:.0f}): {sid}')

        dup = any(st2['chain'] == tuple(chain) for st2 in stations.values())
        stations[sid] = {'est': est, 'ls': ls, 'lines': lids, 'lb': lb, 'chain': tuple(chain), 'hide': dup}

    # ---- Match stations to TfL's own stops by following each line in order.
    # Walking a line's centreline from one end to the other passes its stops
    # (circles, step-free icons, ticks) in the same order as our station list,
    # so a sequence alignment pairs them up even where labels are crowded.
    serve = {}
    for i, m in enumerate(markers):
        on = {lid for lid in LINES if geoms[lid].dist([m['c']])[0] < 4.5}
        on = on or {lid for lid in LINES if geoms[lid].dist([m['c']])[0] < 9}
        # end-of-line icons sit just past the end of the traced centreline
        serve[i] = on or {lid for lid in LINES if geoms[lid].dist([m['c']])[0] < 14}
        if m['kind'] == 'pier':
            serve[i] = set()

    def label_dist(lb, p):
        bx0, by0, bx1, by1 = lb
        return math.hypot(max(bx0 - p[0], 0, p[0] - bx1), max(by0 - p[1], 0, p[1] - by1))

    claims = {}   # stop key -> list of (cost, sid)
    matched = {sid: {} for sid in stations}   # sid -> lid -> [stop key, ...]
    stop_pos = {}
    for lid, l in LINES.items():
        g = geoms[lid]
        mstops = [i for i in range(len(markers)) if lid in serve[i]]
        for br in l['branches']:
            br = [s_ for s_ in br if s_ in stations]
            if len(br) < 2:
                continue
            path = []
            for a_, b_ in zip(br, br[1:]):
                pa, _ = g.nearest(stations[a_]['est'])
                pb, _ = g.nearest(stations[b_]['est'])
                seg, _ = g.route(pa, pb, margin=80)
                path.extend(seg.tolist())
            P = np.array(path)
            ptree = cKDTree(P)
            cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
            stops = []
            for i in mstops:
                d, k = ptree.query(markers[i]['c'])
                # line ends: TfL's end marker sits a little past the traced centreline
                d0 = math.hypot(markers[i]['c'][0] - P[0][0], markers[i]['c'][1] - P[0][1])
                d1 = math.hypot(markers[i]['c'][0] - P[-1][0], markers[i]['c'][1] - P[-1][1])
                if d < 6:
                    stops.append((cum[k], ('m', i), markers[i]['c']))
                elif d0 < 22:
                    stops.append((-d0, ('m', i), markers[i]['c']))
                elif d1 < 22:
                    stops.append((cum[-1] + d1, ('m', i), markers[i]['c']))
            mpos = [markers[i]['c'] for i in mstops]
            for ti, t in enumerate(g.ticks):
                # TfL sometimes leaves a tick hidden under a circle: the circle wins
                if any(math.hypot(t[0] - c_[0], t[1] - c_[1]) < 11 for c_ in mpos):
                    continue
                d, k = ptree.query(t)
                d0 = math.hypot(t[0] - P[0][0], t[1] - P[0][1])
                d1 = math.hypot(t[0] - P[-1][0], t[1] - P[-1][1])
                if d < 9:
                    stops.append((cum[k], ('t', lid, ti), tuple(g.nearest(t)[0])))
                elif d0 < 20:
                    stops.append((-d0, ('t', lid, ti), tuple(g.nearest(t)[0])))
                elif d1 < 20:
                    stops.append((cum[-1] + d1, ('t', lid, ti), tuple(g.nearest(t)[0])))
            stops.sort(key=lambda x: x[0])
            n, m = len(br), len(stops)
            def c(i, j):
                st = stations[br[i]]
                q = stops[j][2]
                return min(200.0, label_dist(st['lb'], q) + 0.3 * math.hypot(q[0] - st['est'][0], q[1] - st['est'][1]))
            SKIP_STATION = 70.0
            C = np.full((n + 1, m + 1), 1e18)
            C[0, :] = 0
            B = np.zeros((n + 1, m + 1), dtype=np.int8)  # 0 skip stop, 1 match, 2 skip station
            for i in range(1, n + 1):
                C[i, 0] = C[i - 1, 0] + SKIP_STATION; B[i, 0] = 2
                for j in range(1, m + 1):
                    opts = (C[i, j - 1], C[i - 1, j - 1] + c(i - 1, j - 1), C[i - 1, j] + SKIP_STATION)
                    k = int(np.argmin(opts))
                    C[i, j], B[i, j] = opts[k], k
            i, j = n, m
            while i > 0:
                if j == 0 or B[i, j] == 2:
                    i -= 1
                elif B[i, j] == 1:
                    sid = br[i - 1]
                    key = stops[j - 1][1]
                    stop_pos[key] = stops[j - 1][2]
                    matched[sid].setdefault(lid, []).append(key)
                    claims.setdefault(key, []).append((c(i - 1, j - 1), sid))
                    i -= 1; j -= 1
                else:
                    j -= 1
    dbg = set(filter(None, os.environ.get('TUBEMAKER_DEBUG', '').split(',')))
    for sid in dbg:
        if sid in matched:
            log('DEBUG', sid, 'est', np.round(stations[sid]['est'], 1), {l: [(k, np.round(stop_pos[k], 1)) for k in ks] for l, ks in matched[sid].items()})
    for key, cl in claims.items():
        if len({c_[1] for c_ in cl}) > 1 and dbg & {c_[1] for c_ in cl}:
            log('DEBUG claim', key, np.round(stop_pos[key], 1), cl)
    # a stop claimed by two stations goes to the better match
    owner_of = {}
    for key, cl in claims.items():
        tally = {}
        for cost, sid in cl:
            v = tally.setdefault(sid, [0, 0.0]); v[0] += 1; v[1] += cost
        owner_of[key] = min(tally, key=lambda s_: (-tally[s_][0], tally[s_][1] / tally[s_][0]))
    taken = {}
    for sid, st in stations.items():
        st['mk'], st['pos'], st['kind'], st['cands'] = [], None, None, {}
        votes = {}
        for lid, keys in matched[sid].items():
            for key in keys:
                if owner_of.get(key) != sid:
                    continue
                st['cands'].setdefault(lid, []).append(stop_pos[key])
                votes[key] = votes.get(key, 0) + 1
        mks = sorted([k for k in votes if k[0] == 'm'], key=lambda k: -votes[k])
        if mks:
            st['mk'] = [k[1] for k in mks]
            for i in st['mk']:
                taken[i] = sid
            st['pos'], st['kind'] = markers[st['mk'][0]]['c'], markers[st['mk'][0]]['kind']
        elif votes:
            pts = [stop_pos[k] for k in votes]
            st['pos'], st['kind'] = tuple(np.mean(pts, axis=0)), 'tick'
    # grow complexes: circles joined by a bar to a station's marker belong to it
    grown = True
    while grown:
        grown = False
        for sid, st in stations.items():
            for i in list(st['mk']):
                for j in mk_tree.query_ball_point(markers[i]['c'], 45):
                    if j not in taken and joined(black, markers[i]['c'], markers[j]['c']):
                        st['mk'].append(j)
                        taken[j] = sid
                        grown = True

    for sid, st in stations.items():
        if st['pos'] is None:
            free = [i for i in mk_tree.query_ball_point(st['est'], 35) if i not in taken and markers[i]['kind'] != 'pier']
            if free:
                i = min(free, key=lambda i: math.hypot(markers[i]['c'][0] - st['est'][0], markers[i]['c'][1] - st['est'][1]))
                st['mk'], st['pos'], st['kind'] = [i], markers[i]['c'], markers[i]['kind']
                taken[i] = sid
                for lid in st['lines']:
                    st['cands'].setdefault(lid, []).append(markers[i]['c'])
    for sid, st in stations.items():
        if st['pos'] is None:
            pts = [geoms[lid].nearest(st['est'])[0] for lid in st['lines']]
            st['pos'], st['kind'] = tuple(np.mean(pts, axis=0)), 'guess'
            problems.append(f'no marker or tick: {sid}')
        # candidate points for each line at this station
        for lid in st['lines']:
            # every marker of the complex that this line passes through is a candidate
            cs = list(st['cands'].get(lid, []))
            cs += [markers[i]['c'] for i in st['mk'] if lid in serve[i] and markers[i]['c'] not in cs]
            st['cands'][lid] = cs or [tuple(geoms[lid].nearest(st['pos'])[0])]
        pos = st['pos']
        # Accessibility from the marker itself; National Rail symbol next to the label.
        if st['kind'] in ('train', 'platform'):
            step = st['kind']
        else:
            kinds = {markers[j]['kind'] for j in st['mk']} | {markers[j]['kind'] for j in mk_tree.query_ball_point(pos, 12)}
            step = 'train' if 'train' in kinds else 'platform' if 'platform' in kinds else 'none'
        nr = None
        if rail_tree is not None:
            bx0, by0, bx1, by1 = st['lb']
            best_r = None
            for j in rail_tree.query_ball_point(((bx0 + bx1) / 2, (by0 + by1) / 2), (bx1 - bx0) / 2 + 30):
                rx, ry = rail[j]
                if bx0 - 24 <= rx <= bx1 + 24 and by0 - 16 <= ry <= by1 + 16 and j not in used_rail:
                    dd = math.hypot(max(bx0 - rx, 0, rx - bx1), max(by0 - ry, 0, ry - by1))
                    if best_r is None or dd < best_r[0]:
                        best_r = (dd, j)
            if best_r:
                used_rail.add(best_r[1])
                nr = rail[best_r[1]]
        # airport / riverboat / coach pictograms next to the label, where TfL put them
        st['placed'] = []
        for kind, c, w in icons:
            if (kind, c) in used_icons or any(math.hypot(c[0] - m_['c'][0], c[1] - m_['c'][1]) < 4 for m_ in markers if m_['kind'] == 'pier'):
                continue
            bx0, by0, bx1, by1 = st['lb']
            if bx0 - 26 <= c[0] <= bx1 + 26 and by0 - 14 <= c[1] <= by1 + 14:
                used_icons.add((kind, c))
                st['placed'].append({'type': {'boat': 'river-far'}.get(kind, kind), 'x': c[0], 'y': c[1], 'w': round(w, 2)})
        # bars between the markers of a complex
        mk = st['mk']
        st['links'] = [[a_, b_, 'bar'] for a_ in range(len(mk)) for b_ in range(a_ + 1, len(mk))
                       if math.hypot(markers[mk[a_]]['c'][0] - markers[mk[b_]]['c'][0], markers[mk[a_]]['c'][1] - markers[mk[b_]]['c'][1]) < 60
                       and joined(black, markers[mk[a_]]['c'], markers[mk[b_]]['c'])]
        st['pos'] = (float(pos[0]), float(pos[1]))
        st['step'], st['nr'] = step, nr

    # ---- Dotted walking links, straight from the artwork.
    owner = {}
    for sid, st in stations.items():
        for k, i in enumerate(st['mk']):
            owner[i] = (sid, k)
    walks = []  # [station a, station b, type, point a, point b]
    for e1, e2 in dot_chains(find_dots(items)):
        ends = []
        for e in (e1, e2):
            hit = None
            for i in mk_tree.query_ball_point(e, 14):
                d = math.hypot(markers[i]['c'][0] - e[0], markers[i]['c'][1] - e[1])
                if i in owner and (hit is None or d < hit[0]):
                    hit = (d, owner[i], markers[i]['c'])
            if hit is None:  # a station without a circle (tick)
                best = min(stations.items(), key=lambda kv: math.hypot(kv[1]['pos'][0] - e[0], kv[1]['pos'][1] - e[1]))
                if math.hypot(best[1]['pos'][0] - e[0], best[1]['pos'][1] - e[1]) < 16:
                    hit = (0, (best[0], 0), best[1]['pos'])
            ends.append(hit)
        if bool(ends[0]) != bool(ends[1]):
            # a dotted walk from a station to a river pier
            known, other = (ends[0], e2) if ends[0] else (ends[1], e1)
            pier = [i for i in mk_tree.query_ball_point(other, 14) if markers[i]['kind'] == 'pier' and i not in owner]
            if pier:
                (_, (s1, k1), _p) = known
                st = stations[s1]
                st['mk'].append(pier[0])
                owner[pier[0]] = (s1, len(st['mk']) - 1)
                st['links'].append([k1, len(st['mk']) - 1, 'walk'])
                st['river_pier'] = True
            continue
        if not ends[0] or not ends[1]:
            continue
        (_, (s1, k1), p1), (_, (s2, k2), p2) = ends
        if s1 == s2:
            if k1 != k2:
                stations[s1]['links'].append([k1, k2, 'walk'])
        elif not any({s1, s2} == {w[0], w[1]} for w in walks):
            walks.append([s1, s2, 'walk', p1, p2])
    # bars joining circles of different stations (e.g. Bank - Monument); the
    # closest joined pair of markers wins
    joins = []
    for i, (s1, k1) in owner.items():
        for j in mk_tree.query_ball_point(markers[i]['c'], 60):
            if j in owner and owner[j][0] != s1 and i < j and joined(black, markers[i]['c'], markers[j]['c']):
                d = math.hypot(markers[i]['c'][0] - markers[j]['c'][0], markers[i]['c'][1] - markers[j]['c'][1])
                joins.append((d, s1, owner[j][0], markers[i]['c'], markers[j]['c']))
    for d, s1, s2, p1, p2 in sorted(joins):
        if not any({s1, s2} == {w[0], w[1]} for w in walks):
            walks.append([s1, s2, 'internal', p1, p2])
    log(f'{len(walks)} walking links / joins')

    # ------------------------------------------------ per-line track geometry
    log('tracing tracks…')
    edges = {}
    for lid, l in LINES.items():
        g = geoms[lid]
        for br in l['branches']:
            br = [s_ for s_ in br if s_ in stations]
            for a, b in zip(br, br[1:]):
                best = None
                # a station can have several markers for one line (Paddington's
                # two Circle line stops): use the pair that gives the cleanest trace
                for A in stations[a]['cands'][lid]:
                    for B in stations[b]['cands'][lid]:
                        pa, da = g.nearest(A)
                        pb, db = g.nearest(B)
                        path, ratio = g.route(pa, pb)
                        if ratio > 3:
                            path, ratio = g.route(pa, pb, margin=200)
                        L = float(np.sum(np.hypot(*np.diff(path, axis=0).T))) if len(path) > 1 else 0
                        score = ratio * 1000 + L + 5 * (da + db)
                        if best is None or score < best[0]:
                            best = (score, A, B, path, ratio, da, db)
                _, A, B, path, ratio, da, db = best
                if ratio > 4 or da > 12 or db > 12:
                    problems.append(f'poor trace {lid} {a}->{b} ({ratio:.1f}, {da:.0f}, {db:.0f})')
                    pts = [A, B]
                else:
                    # each line keeps its own offset under the station marker
                    pts = octilinear_path(path, end_snap=9)
                sa, sb = slug(a), slug(b)
                key = sa + '|' + sb if sa < sb else sb + '|' + sa
                if not sa < sb:
                    pts = pts[::-1]
                rel = [[round(x - MAP_X0, 2), round(y - MAP_Y0, 2)] for x, y in pts]
                edges.setdefault(key, {'lines': {}})['lines'][lid] = rel

    # ---- "Station in both fare zones": TfL boxes the label in white with a grey border.
    boxes = []
    for it in items:
        if it['fill'] == WHITE and it['stroke'] == (211, 210, 210):
            for sub in it['subs']:
                x0, y0, x1, y1 = bbox(flat(sub))
                if in_map(x0, y0) and 15 < x1 - x0 < 200 and 8 < y1 - y0 < 60:
                    boxes.append((x0, y0, x1, y1, round(it['width'], 2)))
    for sid, st in stations.items():
        bx0, by0, bx1, by1 = st['lb']
        for b in boxes:
            if b[0] - 1 <= bx0 and b[2] + 1 >= bx1 and b[1] - 1 <= by0 and b[3] + 1 >= by1:
                cx, cy = st['pos']
                st['box'] = [round(b[0] - cx, 2), round(b[1] - cy, 2), round(b[2] - b[0], 2), round(b[3] - b[1], 2), b[4]]
                break
    # ---- Line stacking order as drawn by TfL (index of each line's biggest shape)
    zorder = {}
    for lid, col in VEC_COLOURS.items():
        best = None
        for n, it in enumerate(items):
            if it['fill'] == col or (it['stroke'] == col and 3 < it['width'] < 7):
                ext = 0
                for sub in it['subs']:
                    x0, y0, x1, y1 = bbox(flat(sub, 2))
                    if x0 < MAP_X1:
                        ext = max(ext, (x1 - x0) + (y1 - y0))
                if best is None or ext > best[0]:
                    best = (ext, n)
        zorder[lid] = best[1] if best else 0

    # ------------------------------------------------------------ labels
    # Official station facts from the TfL Unified API (tools/fetch_tfl.py)
    tfl_path = os.path.join(os.path.dirname(__file__), 'tfl_stations.json')
    tfl = json.load(open(tfl_path, encoding='utf-8'))['stations'] if os.path.exists(tfl_path) else {}
    out_st = []
    for sid, st in stations.items():
        cx, cy = st['pos']
        ls = st['ls']
        bx0 = min(l['x0'] for l in ls); bx1 = max(l['x1'] for l in ls)
        # baseline of the first label line from the glyph origins
        l0 = ls[0]
        cand = base_tree.query_ball_point(((l0['x0'] + l0['x1']) / 2, l0['y1']), (l0['x1'] - l0['x0']) / 2 + 6)
        bl = [baselines[i][1] for i in cand if l0['y0'] <= baselines[i][1] <= l0['y1'] + 1 and l0['x0'] - 1 <= baselines[i][0] <= l0['x1']]
        base = float(np.median(bl)) if bl else l0['y0'] + 10.3
        if len(ls) > 1:
            # wrapped labels: use the alignment TfL actually used for the lines
            spread = {
                'start': max(l['x0'] for l in ls) - min(l['x0'] for l in ls),
                'end': max(l['x1'] for l in ls) - min(l['x1'] for l in ls),
                'middle': max((l['x0'] + l['x1']) / 2 for l in ls) - min((l['x0'] + l['x1']) / 2 for l in ls),
            }
            anchor = min(spread, key=lambda k: (spread[k], {'start': 0, 'end': 1, 'middle': 2}[k]))
            if spread[anchor] > 3:  # no clean alignment: fall back to the side of the station
                anchor = 'start' if bx0 >= cx - 4 else 'end' if bx1 <= cx + 4 else 'middle'
        else:
            anchor = 'start' if bx0 >= cx - 4 else 'end' if bx1 <= cx + 4 else 'middle'
        ax = {'start': bx0, 'end': bx1, 'middle': (bx0 + bx1) / 2}[anchor]
        if anchor == 'start' and len(ls) > 1:
            ax = ls[0]['x0']
        elif anchor == 'end' and len(ls) > 1:
            ax = ls[0]['x1']
        out_st.append({
            'id': slug(sid), 'name': DISPLAY.get(sid, sid),
            'x': round(cx - MAP_X0, 2), 'y': round(cy - MAP_Y0, 2),
            'label': {'lines': [l['text'] for l in ls], 'dx': round(ax - cx, 2), 'dy': round(base - cy, 2), 'anchor': anchor,
                      'lh': round(ls[1]['y0'] - ls[0]['y0'], 2) if len(ls) > 1 else None},
            'icons': [{'type': ic['type'], 'dx': round(ic['x'] - cx, 2), 'dy': round(ic['y'] - cy, 2), 'w': ic['w']} for ic in st['placed']],
            'nationalRail': bool(st['nr']),
            'rail': [round(st['nr'][0] - cx, 2), round(st['nr'][1] - cy, 2)] if st['nr'] else None, 'airport': any(i['type'] == 'airport' for i in st['placed']),
            'river': 'near' if st.get('river_pier') else 'far' if any(i['type'] == 'river-far' for i in st['placed']) else 'none',
            'coach': any(i['type'] == 'coach' for i in st['placed']),
            'stepFree': st['step'], 'marker': st['kind'],
            'extra': [{'x': round(markers[i]['c'][0] - MAP_X0, 2), 'y': round(markers[i]['c'][1] - MAP_Y0, 2), 'kind': markers[i]['kind']}
                      for i in st['mk'][1:]],
            'links': st['links'],
            'tfl': tfl_info(sid, tfl),
            'box': st.get('box'),
            'hideLabel': st['hide'],
        })

    hexc = lambda c: '#%02X%02X%02X' % c
    out_lines = [{'id': lid, 'name': l['name'], 'color': hexc(VEC_COLOURS[lid]), 'style': l['style'], 'group': l.get('group', ''),
                  'branches': [[slug(s) for s in br if s in stations] for br in l['branches']], 'z': zorder[lid]}
                 for lid, l in LINES.items()]

    # ------------------------------------------------ river, zones, numbers
    rel = lambda pts: [[round(x - MAP_X0, 1), round(y - MAP_Y0, 1)] for x, y in pts]
    river = [rel(r) for shape in fills_of(items, (204, 239, 252), 50) for r in shape]
    # TfL builds the fare-zone bands as alternating grey and white shapes stacked
    # in drawing order, with white outlines between neighbouring zones.
    zones = []
    ZCOL = {(244, 244, 244): '#f4f4f4', (255, 255, 255): '#ffffff', (229, 235, 248): '#e5ebf8',
            (229, 228, 228): '#e5e4e4', (222, 221, 222): '#dedede'}
    for it in items:
        col = it['fill'] if it['fill'] in ZCOL else None
        if not col and not (it['stroke'] == WHITE and 3.5 < it['width'] < 5):
            continue
        rings = []
        for sub in it['subs']:
            pts = flat(sub, 8)
            x0, y0, x1, y1 = bbox(pts)
            if max(x1 - x0, y1 - y0) < (150 if col in ((244, 244, 244), (255, 255, 255)) else 60) or x1 < MAP_X0 or y1 < MAP_Y0 or x0 > MAP_X1:
                continue
            if x0 >= 350 and x1 <= 965 and y0 >= 1575:
                continue  # TfL's own key box
            rings.append(rel(pts))
        if not rings:
            continue
        if col:
            zones.append({'fill': ZCOL[col], 'rings': rings})
        else:
            zones.append({'fill': 'none', 'stroke': '#ffffff', 'strokeWidth': round(it['width'], 2), 'rings': rings})
    numbers = []
    for w in words:
        if re.fullmatch(r'\d(/\d)?', w['raw']) and w['y1'] - w['y0'] > 30 and in_map(w['x0'], w['y0']):
            numbers.append({'text': w['raw'], 'x': round(w['x0'] - MAP_X0, 1), 'y': round(w['y1'] - MAP_Y0 - (w['y1'] - w['y0']) * 0.2, 1),
                            'size': round((w['y1'] - w['y0']) * 0.86, 1)})

    data = {'walks': [[slug(a), slug(b), t, [round(pa[0] - MAP_X0, 2), round(pa[1] - MAP_Y0, 2)], [round(pb[0] - MAP_X0, 2), round(pb[1] - MAP_Y0, 2)]]
                      for a, b, t, pa, pb in walks], 'width': MAP_X1 - MAP_X0, 'height': MAP_Y1 - MAP_Y0, 'stations': out_st, 'lines': out_lines,
            'edges': edges, 'river': river, 'zones': zones, 'zoneNumbers': numbers}
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_template.py from the TfL large print Tube map (vector artwork).\n')
        f.write('// Excludes Thameslink, London Cable Car and London Trams.\n')
        f.write('window.TUBE_TEMPLATE_FULL = ' if FULL else 'window.TUBE_TEMPLATE = ')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    kinds = {}
    for s in stations.values():
        kinds[s['kind']] = kinds.get(s['kind'], 0) + 1
    log(f"{len(out_st)} stations {kinds}, {len(edges)} edges, {len(zones)} zone shapes, {len(river)} river shapes, {len(numbers)} zone numbers")
    for p in problems:
        log('WARN', p)


if __name__ == '__main__':
    main(*sys.argv[1:4])
