#!/usr/bin/env python3
"""Build assets/js/template-data.js from the TfL large print Tube map.

Usage:
  pdftotext -f 1 -l 1 -bbox large-print-tube-map.pdf words.html
  pdftoppm  -f 1 -l 1 -r 72 -png large-print-tube-map.pdf map     # -> map-1.png
  python3 tools/build_template.py words.html map-1.png assets/js/template-data.js

The script finds every station label in the PDF text layer, then looks for the
coloured line strokes of each of the station's lines next to that label to
locate the station marker.  Labels keep their original line wrapping and their
position relative to the marker, so the result looks like the reference map.
"""
import html
import json
import math
import re
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lines_data import (LINES, DISPLAY, SEARCH, NATIONAL_RAIL, AIRPORT, RIVER, COACH,  # noqa: E402
                        STEP_FREE_TRAIN, STEP_FREE_PLATFORM)

# Line colours as rendered on the PDF map (sampled near stations).
PDF_COLOURS = {
    "bakerloo": (174, 83, 14), "central": (238, 39, 34), "circle": (252, 203, 6),
    "district": (21, 119, 61), "hammersmith-city": (244, 104, 161), "jubilee": (148, 152, 154),
    "metropolitan": (150, 1, 84), "northern": (35, 31, 32), "piccadilly": (38, 61, 150),
    "victoria": (55, 162, 225), "waterloo-city": (115, 206, 167), "dlr": (33, 181, 176),
    "elizabeth": (92, 66, 163), "liberty": (79, 93, 98), "lioness": (248, 156, 14),
    "mildmay": (36, 134, 203), "suffragette": (89, 195, 100), "weaver": (176, 35, 127),
    "windrush": (237, 25, 46),
}

# Stations whose marker cannot be found automatically (PDF point coordinates).
POSITION_OVERRIDES = {
    "Euston": (1565, 845),
}

# Crop of the PDF page that contains the map itself (points).
MAP_X0, MAP_Y0, MAP_X1, MAP_Y1 = 340, 250, 2790, 1975


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
    """Return list of candidate matches: (list_of_word_indices)."""
    target = [norm(t) for t in name.replace("-", "- ").split() if norm(t)]
    # handle hyphenated words split across lines e.g. "Harrow-" "on-the-Hill"
    joined = norm(name.replace(" ", ""))
    cands = []
    for i, w in enumerate(words):
        if not (MAP_X0 <= w["x0"] <= MAP_X1 and MAP_Y0 <= w["y0"] <= MAP_Y1):
            continue
        # chain matching on concatenated text so hyphen splits work
        acc = w["n"]
        if not joined.startswith(acc):
            continue
        chain = [i]
        cur = w
        while acc != joined:
            best = None
            for j, v in enumerate(words):
                if j in chain:
                    continue
                if not joined.startswith(acc + v["n"]):
                    continue
                same = abs(v["y0"] - cur["y0"]) < 3 and 0 <= v["x0"] - cur["x1"] <= 14
                nxt = 7 < v["y0"] - cur["y0"] < 17 and abs((v["x0"] + v["x1"]) / 2 - (cur["x0"] + cur["x1"]) / 2) < 110
                first = words[chain[0]]
                nxt = nxt or (7 < v["y0"] - cur["y0"] < 17 and abs(v["x0"] - first["x0"]) < 90)
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


def main(words_path, png_path, out_path):
    words = load_words(words_path)
    img = np.asarray(Image.open(png_path).convert("RGB")).astype(int)

    masks = {}
    trace_masks = {}
    dts = {}
    for lid, c in PDF_COLOURS.items():
        m = np.abs(img - np.array(c)).max(axis=2) <= 12
        # Keep only pixels that belong to long strokes: label text and
        # accessibility icons share some colours but are small or thin.
        if LINES[lid]["style"] == "double":
            keep = m & (box_sum(m, 15) >= 20)
        else:
            core = box_sum(m, 1) >= 9           # 3x3 erosion removes text
            keep = core & (box_sum(core, 30) >= 105)  # removes icon discs
        ys, xs = np.nonzero(keep)
        masks[lid] = np.stack([xs, ys], axis=1)
        trace_masks[lid] = box_sum(m, 2 if LINES[lid]["style"] == "double" else 1) > 0
        dts[lid] = distance_transform_edt(~keep)

    station_lines = {}
    for lid, l in LINES.items():
        for br in l["branches"]:
            for s in br:
                station_lines.setdefault(s, [])
                if lid not in station_lines[s]:
                    station_lines[s].append(lid)

    used_words = set()
    stations = {}
    problems = []
    # Longer names first so "Kentish Town West" claims its words before "Kentish Town".
    order = sorted(station_lines.items(), key=lambda kv: -len(SEARCH.get(kv[0], DISPLAY.get(kv[0], kv[0]))))
    for sid, lids in order:
        name = SEARCH.get(sid, DISPLAY.get(sid, sid))
        cands = find_label(words, name)
        if not cands:
            problems.append(f"no label: {sid}")
            continue
        # Pick the candidate with line pixels closest to its bounding box.
        best = None
        for chain in cands:
            ls = label_lines(words, chain)
            bx0 = min(l["x0"] for l in ls); bx1 = max(l["x1"] for l in ls)
            by0 = min(l["y0"] for l in ls); by1 = max(l["y1"] for l in ls)
            pts = []
            score = 0
            for lid in lids:
                m = masks[lid]
                sel = m[(m[:, 0] > bx0 - 70) & (m[:, 0] < bx1 + 70) & (m[:, 1] > by0 - 70) & (m[:, 1] < by1 + 70)]
                if len(sel) == 0:
                    score += 200
                    continue
                dx = np.maximum(np.maximum(bx0 - sel[:, 0], 0), sel[:, 0] - bx1)
                dy = np.maximum(np.maximum(by0 - sel[:, 1], 0), sel[:, 1] - by1)
                dist = np.hypot(dx, dy)
                k = int(np.argmin(dist))
                p = sel[k]
                near = sel[np.hypot(sel[:, 0] - p[0], sel[:, 1] - p[1]) < 6]
                pts.append(near.mean(axis=0))
                score += float(dist[k])
            if used_words & set(chain):
                score += 1000
            if best is None or score < best[0]:
                best = (score, chain, ls, pts, (bx0, by0, bx1, by1))
        score, chain, ls, pts, bbox = best
        used_words.update(chain)
        # The station is the point near its label where all of its lines meet.
        bx0, by0, bx1, by1 = bbox
        wx0, wy0 = int(bx0 - 60), int(by0 - 60)
        wx1, wy1 = int(bx1 + 60), int(by1 + 60)
        yy, xx = np.mgrid[wy0:wy1, wx0:wx1]
        ddx = np.maximum(np.maximum(bx0 - xx, 0), xx - bx1)
        ddy = np.maximum(np.maximum(by0 - yy, 0), yy - by1)
        cost = 0.15 * np.hypot(ddx, ddy)
        for lid in lids:
            cost = cost + np.minimum(dts[lid][wy0:wy1, wx0:wx1], 60)
        k = np.unravel_index(int(np.argmin(cost)), cost.shape)
        cx, cy = float(xx[k]), float(yy[k])
        if sid in POSITION_OVERRIDES:
            cx, cy = POSITION_OVERRIDES[sid]
        if not pts:
            problems.append(f"no line pixels: {sid}")
        if score > 90:
            problems.append(f"far ({score:.0f}): {sid}")
        stations[sid] = {"cx": cx, "cy": cy, "ls": ls, "lines": lids}

    # Output in map coordinates (origin at the map crop).
    out_st = []
    for sid, st in stations.items():
        x = round(st["cx"] - MAP_X0, 1); y = round(st["cy"] - MAP_Y0, 1)
        ls = st["ls"]
        bx0 = min(l["x0"] for l in ls); bx1 = max(l["x1"] for l in ls)
        by0 = min(l["y0"] for l in ls)
        lcx = (bx0 + bx1) / 2
        # anchor: label left of marker -> end, right -> start, above/below -> middle
        if bx0 >= st["cx"] - 4:
            anchor = "start"; ax = bx0
        elif bx1 <= st["cx"] + 4:
            anchor = "end"; ax = bx1
        else:
            anchor = "middle"; ax = lcx
        out_st.append({
            "id": slug(sid), "name": DISPLAY.get(sid, sid), "x": x, "y": y,
            "label": {"lines": [l["text"] for l in ls], "dx": round(ax - st["cx"], 1),
                      "dy": round(by0 - st["cy"] + 9.5, 1), "anchor": anchor},
            "nationalRail": sid in NATIONAL_RAIL, "airport": sid in AIRPORT, "river": sid in RIVER,
            "coach": sid in COACH,
            "stepFree": "train" if sid in STEP_FREE_TRAIN else ("platform" if sid in STEP_FREE_PLATFORM else "none"),
        })
    out_lines = []
    for lid, l in LINES.items():
        vias = {}
        for br in l["branches"]:
            br = [s for s in br if s in stations]
            for a, b in zip(br, br[1:]):
                pa = (stations[a]["cx"], stations[a]["cy"])
                pb = (stations[b]["cx"], stations[b]["cy"])
                pts = trace(trace_masks[lid], pa, pb)
                if pts:
                    vias[slug(a) + ">" + slug(b)] = [[round(x - MAP_X0, 1), round(y - MAP_Y0, 1)] for x, y in pts]
        out_lines.append({"id": lid, "name": l["name"], "color": l["color"], "style": l["style"],
                          "group": l.get("group", ""),
                          "branches": [[slug(s) for s in br if s in stations] for br in l["branches"]],
                          "vias": vias})
    river = trace_river(img)
    data = {"river": [[round(x - MAP_X0, 1), round(y - MAP_Y0, 1)] for x, y in river],
            "width": MAP_X1 - MAP_X0, "height": MAP_Y1 - MAP_Y0, "stations": out_st, "lines": out_lines}
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_template.py from the TfL large print Tube map layout.\n")
        f.write("// Excludes Thameslink, London Cable Car and London Trams.\n")
        f.write("window.TUBE_TEMPLATE = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"{len(out_st)} stations", file=sys.stderr)
    for p in problems:
        print("WARN", p, file=sys.stderr)


def trace_river(img):
    """Centre line of the River Thames (pale blue fill) as a simplified polyline."""
    from collections import deque
    from skimage.morphology import binary_closing, disk, skeletonize, remove_small_objects
    m = np.abs(img - np.array([204, 239, 252])).max(axis=2) <= 10
    m[:, :MAP_X0] = False; m[:, MAP_X1:] = False; m[:MAP_Y0, :] = False; m[MAP_Y1:, :] = False
    m = binary_closing(m, disk(7))
    m = remove_small_objects(m, 5000)
    sk = skeletonize(m)
    ys, xs = np.nonzero(sk)
    nodes = set(zip(ys.tolist(), xs.tolist()))

    def bfs(start):
        prev = {start: None}
        q = deque([start]); last = start
        while q:
            cur = q.popleft(); last = cur
            y, x = cur
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    n = (y + dy, x + dx)
                    if n in nodes and n not in prev:
                        prev[n] = cur; q.append(n)
        return last, prev
    # longest path (tree diameter) starting from the westernmost skeleton pixel
    west = min(nodes, key=lambda p: p[1])
    a, _ = bfs(west)
    b, prev = bfs(a)
    path = []
    cur = b
    while cur is not None:
        path.append((cur[1], cur[0])); cur = prev[cur]
    if path[0][0] > path[-1][0]:
        path.reverse()
    return [tuple(map(float, p)) for p in rdp(np.array(path, float), 4)]


def trace(mask, pa, pb, margin=70):
    """Follow the line's own pixels from pa to pb; return simplified bend points."""
    from skimage.graph import route_through_array
    h, w = mask.shape
    x0 = int(max(min(pa[0], pb[0]) - margin, 0)); x1 = int(min(max(pa[0], pb[0]) + margin, w - 1))
    y0 = int(max(min(pa[1], pb[1]) - margin, 0)); y1 = int(min(max(pa[1], pb[1]) + margin, h - 1))
    sub = mask[y0:y1 + 1, x0:x1 + 1]
    ys, xs = np.nonzero(sub)
    if len(xs) < 5:
        return None
    def nearest(p):
        d = np.hypot(xs + x0 - p[0], ys + y0 - p[1])
        k = int(np.argmin(d))
        return (int(ys[k]), int(xs[k])), float(d[k])
    (sa, da), (sb, db) = nearest(pa), nearest(pb)
    if da > 60 or db > 60:
        return None
    cost = np.where(sub, 1.0, 8.0)
    path, total = route_through_array(cost, sa, sb, fully_connected=True, geometric=True)
    path = np.array(path, dtype=float)
    length = np.sum(np.hypot(*np.diff(path, axis=0).T)) if len(path) > 1 else 0
    if length == 0 or total > length * 2.5:   # mostly off the line: give up
        return None
    pts = rdp(path[:, ::-1] + [x0, y0], 2.5)
    # interior bend points only; endpoints are the stations themselves
    inner = [tuple(p) for p in pts[1:-1]]
    # drop bends that are basically on the straight station-to-station segment
    if inner and all(seg_dist(p, pa, pb) < 3 for p in inner):
        return None
    return inner


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
        left = rdp(pts[:k + 1], eps)
        right = rdp(pts[k:], eps)
        return np.vstack([left[:-1], right])
    return np.vstack([a, b])


def box_sum(m, r):
    """Number of set pixels in the (2r+1)^2 window around every pixel."""
    ii = np.pad(m.astype(np.int32), ((r + 1, r), (r + 1, r))).cumsum(0).cumsum(1)
    k = 2 * r + 1
    return ii[k:, k:] - ii[:-k, k:] - ii[k:, :-k] + ii[:-k, :-k]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", "and")).strip("-")


if __name__ == "__main__":
    main(*sys.argv[1:4])
