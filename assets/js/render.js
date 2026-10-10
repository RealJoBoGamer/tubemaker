/* Renders a map document to an SVG string. Used for the live editor canvas,
 * PNG/PDF export and community thumbnails. */
(function () {
  const { SYMBOLS, NAVY, FIT } = window.TubeSymbols;
  const D = window.TubeDoc;

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r1 = v => Math.round(v * 10) / 10;

  let measureCtx = null;
  function textWidth(text, size, font, weight) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `${weight || 'normal'} ${size}px ${font}`;
    return measureCtx.measureText(text).width;
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function len(v) { return Math.hypot(v[0], v[1]); }
  function unit(v) { const l = len(v) || 1; return [v[0] / l, v[1] / l]; }
  function normalOf(a, b) { const u = unit(sub(b, a)); return [-u[1], u[0]]; }

  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 0.05 || Math.abs(q[1] - p[1]) > 0.05) out.push(p);
    }
    return out;
  }

  /** Offset a polyline sideways by d (positive = left of travel direction). */
  function offsetPolyline(pts, d) {
    if (!d || pts.length < 2) return pts.map(p => p.slice());
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      let n;
      if (i === 0) n = normalOf(pts[0], pts[1]);
      else if (i === pts.length - 1) n = normalOf(pts[i - 1], pts[i]);
      else {
        const n1 = normalOf(pts[i - 1], pts[i]), n2 = normalOf(pts[i], pts[i + 1]);
        const m = unit([n1[0] + n2[0], n1[1] + n2[1]]);
        const k = 1 / Math.max(0.35, m[0] * n2[0] + m[1] * n2[1]);
        n = [m[0] * k, m[1] * k];
      }
      out.push([pts[i][0] + n[0] * d, pts[i][1] + n[1] * d]);
    }
    return out;
  }

  /** SVG path through points with rounded corners. */
  function roundedPath(pts, radius) {
    pts = dedupe(pts);
    if (pts.length < 2) return '';
    let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const A = pts[i - 1], P = pts[i], B = pts[i + 1];
      const la = len(sub(A, P)), lb = len(sub(B, P));
      const ua = unit(sub(A, P)), ub = unit(sub(B, P));
      const cos = ua[0] * ub[0] + ua[1] * ub[1];
      if (cos < -0.995) { d += ` L${r1(P[0])},${r1(P[1])}`; continue; } // straight on
      const r = Math.min(radius, la / 2, lb / 2);
      const p1 = [P[0] + ua[0] * r, P[1] + ua[1] * r];
      const p2 = [P[0] + ub[0] * r, P[1] + ub[1] * r];
      d += ` L${r1(p1[0])},${r1(p1[1])} Q${r1(P[0])},${r1(P[1])} ${r1(p2[0])},${r1(p2[1])}`;
    }
    const L = pts[pts.length - 1];
    d += ` L${r1(L[0])},${r1(L[1])}`;
    return d;
  }

  function lineStroke(line, lw, d, extra = '') {
    const c = esc(line.color);
    switch (line.style) {
      case 'double':
        return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linejoin="round" ${extra}/>` +
          `<path d="${d}" fill="none" stroke="#fff" stroke-width="${r1(lw * 0.36)}" stroke-linejoin="round"/>`;
      case 'dashed':
        return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linejoin="round" stroke-dasharray="${lw * 1.8} ${lw * 0.9}" ${extra}/>`;
      case 'dotted':
        return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linecap="round" stroke-dasharray="0.1 ${lw * 1.7}" ${extra}/>`;
      case 'striped':
        return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linejoin="round" ${extra}/>` +
          `<path d="${d}" fill="none" stroke="#fff" stroke-width="${r1(lw * 0.5)}" stroke-dasharray="${lw * 1.2} ${lw * 1.2}"/>`;
      default:
        return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linejoin="round" ${extra}/>`;
    }
  }

  /** Compute geometry shared by drawing and hit-testing. */
  function geometry(doc, idx) {
    const lw = doc.settings.lineWidth;
    const spacing = lw * 0.95;
    const offsets = new Map(); // edgeKey -> Map(lineId -> d in canonical direction)
    for (const [key, lids] of idx.edgeLines) {
      const m = new Map();
      lids.forEach((lid, i) => m.set(lid, (i - (lids.length - 1) / 2) * spacing));
      offsets.set(key, m);
    }
    return { lw, spacing, offsets };
  }

  /** Points for one line travelling a -> b, already offset for parallel running. */
  function linePoints(doc, idx, geo, lineId, a, b) {
    const key = D.edgeKey(a, b);
    const own = D.ownLinePoints(doc, key, lineId, a, b);
    if (own) return own; // traced path of this very line (keeps TfL's spacing)
    const pts = D.edgePoints(doc, idx, a, b);
    let d = (geo.offsets.get(key) || new Map()).get(lineId) || 0;
    if (!(a < b)) d = -d;
    return offsetPolyline(pts, d);
  }

  function labelMetrics(st, S) {
    const size = S.labelSize * (st.labelScale || 1);
    const lh = size * (S.labelLeading || 1.12);
    const lines = st.label.lines.length ? st.label.lines : [st.name];
    const widths = lines.map(t => textWidth(t, size, S.font, '500'));
    return { size, lh, lines, widths, maxW: Math.max(0, ...widths) };
  }

  function stationIcons(st) {
    const icons = [];
    if (st.stepFree === 'train') icons.push('step-free-train');
    if (st.stepFree === 'platform') icons.push('step-free-platform');
    if (st.nationalRail) icons.push('national-rail');
    if (st.airport) icons.push('airport');
    if (st.river === 'near') icons.push('river-near');
    if (st.river === 'far') icons.push('river-far');
    if (st.coach) icons.push('coach');
    return icons;
  }
  const ICON_W = { 'national-rail': 17, 'coach': 19 };

  function renderKey(doc, idx, opts) {
    const S = doc.settings;
    const k = doc.key;
    const lw = S.lineWidth;
    const font = esc(S.font);
    // Build rows, then flow them into columns.
    const rows = []; // {h, head?, draw: (x, y) => svg}
    const heading = (text, size = 16) => rows.push({ h: 28, head: true,
      draw: (x, y) => `<text x="${x}" y="${y + 19}" font-size="${size}" font-weight="bold" fill="${NAVY}" font-family="${font}">${esc(text)}</text>` });
    heading(k.title || 'Key to lines', 17);
    const visibleLines = doc.lines.filter(l => !l.hidden && l.branches.some(b => b.length > 0));
    const ordered = [...visibleLines.filter(l => !l.group), ...visibleLines.filter(l => l.group)];
    let lastGroup = '';
    for (const l of ordered) {
      if (l.group && l.group !== lastGroup) { heading(l.group, 14); lastGroup = l.group; }
      rows.push({ h: 22, draw: (x, y) => lineStroke(l, lw, `M${x},${y + 11} L${x + 56},${y + 11}`) +
        `<text x="${x + 68}" y="${y + 16}" font-size="13.5" fill="${NAVY}" font-family="${font}">${esc(l.name)}</text>` });
    }
    // Symbols actually used on the map
    const used = new Set();
    for (const s of doc.stations) {
      if (D.isInterchange(s, idx)) used.add('interchange');
      for (const i of stationIcons(s)) used.add(i);
      if (s.closed) used.add('closed');
      if (s.labelBox) used.add('both-zones');
    }
    for (const c of doc.connectors) used.add(c.type === 'internal' ? 'internal-interchange' : 'walk');
    for (const s of doc.symbols) used.add(s.type);
    const order = ['interchange', 'internal-interchange', 'walk', 'step-free-train', 'step-free-platform', 'national-rail',
      'airport', 'river-near', 'river-far', 'coach', 'closed', 'toilets', 'car-park', 'bike', 'outside-fare-zone', 'both-zones'];
    const syms = order.filter(t => used.has(t));
    if (syms.length) {
      heading('Key to symbols', 17);
      for (const t of syms) {
        rows.push({ h: 22, draw: (x, y) => SYMBOLS[t].draw(x + 28, y + 11, 1) +
          `<text x="${x + 68}" y="${y + 16}" font-size="12.5" fill="${NAVY}" font-family="${font}">${esc(SYMBOLS[t].label)}</text>` });
      }
    }
    if (doc.zones.length && S.showZones) {
      rows.push({ h: 22, draw: (x, y) => `<rect x="${x}" y="${y + 4}" width="56" height="14" fill="#eeeeee" stroke="#d0d0d0"/>` +
        `<text x="${x + 68}" y="${y + 16}" font-size="12.5" fill="${NAVY}" font-family="${font}">Fare zones (shaded bands)</text>` });
    }
    const ncols = Math.max(1, Math.min(4, k.columns || 3));
    const colW = 310;
    const total = rows.reduce((a, r) => a + r.h, 0);
    const target = total / ncols;
    const cols = [[]];
    let acc = 0;
    rows.forEach((r, i) => {
      const next = rows[i + 1];
      // start a new column when full; never leave a heading at the bottom of a column
      const need = r.head && next ? r.h + next.h : r.h;
      if (acc > 0 && acc + need > target + 11 && cols.length < ncols) { cols.push([]); acc = 0; }
      cols[cols.length - 1].push(r);
      acc += r.h;
    });
    const parts = [];
    let h = 0;
    cols.forEach((col, ci) => {
      let y = 10;
      for (const r of col) { parts.push(r.draw(16 + ci * colW, y)); y += r.h; }
      h = Math.max(h, y + 10);
    });
    const w = cols.length * colW + 10;
    const sel = opts.selection && opts.selection.kind === 'key';
    return `<g transform="translate(${r1(k.x)},${r1(k.y)})" data-kind="key" class="key">
      <rect x="0" y="0" width="${w}" height="${h}" fill="#fff" stroke="${sel ? '#2f7cf6' : '#c9d3e6'}" stroke-width="${sel ? 3 : 1.5}"/>
      ${parts.join('\n')}</g>`;
  }

  /**
   * opts: { editing, selection, preview, hideKey }
   * returns inner SVG markup (no <svg> wrapper)
   */
  function renderInner(doc, opts = {}) {
    const S = doc.settings;
    const idx = D.buildIndex(doc);
    const geo = geometry(doc, idx);
    const lw = geo.lw;
    const sel = opts.selection || null;
    const editing = !!opts.editing;
    const out = [];

    out.push(`<rect x="0" y="0" width="${doc.width}" height="${doc.height}" fill="${esc(S.background)}" data-kind="bg"/>`);

    // Fare zones
    if (S.showZones) {
      out.push('<g class="zones">');
      for (const z of doc.zones) {
        if (z.rings && z.rings.length) {
          const d = z.rings.map(r => 'M' + r.map(p => `${p[0]},${p[1]}`).join('L') + 'Z').join(' ');
          out.push(z.fill === 'none'
            ? `<path d="${d}" fill="none" stroke="${esc(z.stroke || '#fff')}" stroke-width="${z.strokeWidth || 4}" stroke-linejoin="round" pointer-events="none"/>`
            : `<path d="${d}" fill="${esc(z.fill || '#eee')}" fill-rule="evenodd" data-kind="zone" data-id="${esc(z.id)}"/>`);
          continue;
        }
        const pts = z.points.map(p => p.join(',')).join(' ');
        out.push(`<polygon points="${pts}" fill="${esc(z.fill || '#eee')}" data-kind="zone" data-id="${esc(z.id)}"/>`);
      }
      for (const z of doc.zones) {
        if (!z.points.length || !z.label) continue;
        const p = z.points[0];
        out.push(`<text x="${p[0] + 6}" y="${p[1] + 58}" font-size="64" font-weight="bold" fill="#d9d9d9" font-family="${esc(S.font)}" pointer-events="none">${esc(z.label)}</text>`);
      }
      out.push('</g>');
    }
    // Text placed behind the network (e.g. big zone numbers)
    for (const t of doc.texts) if (t.back) out.push(textMarkup(t, S, sel));

    if (editing && S.showGrid) {
      out.push(`<rect x="0" y="0" width="${doc.width}" height="${doc.height}" fill="url(#grid)" pointer-events="none"/>`);
    }

    // River Thames
    if (S.showRiver && doc.river.polygons && doc.river.polygons.length) {
      const d = doc.river.polygons.map(pl => 'M' + pl.map(p => `${p[0]},${p[1]}`).join('L') + 'Z').join(' ');
      out.push(`<path class="river" data-kind="river" d="${d}" fill="#cceffc" stroke="#1ab5f1" stroke-width="1.2" stroke-linejoin="round" fill-rule="evenodd"/>`);
    } else if (S.showRiver && doc.river.points.length > 1) {
      const d = roundedPath(doc.river.points, 40);
      const w = doc.river.width || 22;
      out.push(`<g class="river" data-kind="river">
        <path d="${d}" fill="none" stroke="#7fcdf0" stroke-width="${w + 3}" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${d}" fill="none" stroke="#d3eefb" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/></g>`);
    }

    // Lines
    out.push('<g class="lines">');
    // stacking order: TfL's own for template lines, list order otherwise
    const drawOrder = doc.lines.map((l, i) => [l, l.z != null ? l.z : 1e6 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    for (const line of drawOrder) {
      if (line.hidden) continue;
      for (const br of line.branches) {
        const ids = br.filter(id => idx.stations.has(id));
        if (ids.length < 2) continue;
        let pts = [];
        for (let i = 0; i < ids.length - 1; i++) {
          if (ids[i] === ids[i + 1]) continue;
          pts = pts.concat(linePoints(doc, idx, geo, line.id, ids[i], ids[i + 1]));
        }
        const d = roundedPath(pts, S.cornerRadius || lw * 2.2);
        if (d) out.push(lineStroke(line, lw, d));
      }
    }
    out.push('</g>');

    // Edge hit targets / selection highlight (editor only)
    if (editing) {
      out.push('<g class="edge-hits">');
      for (const key of idx.edgeLines.keys()) {
        const [a, b] = key.split('|');
        const d = roundedPath(D.edgePoints(doc, idx, a, b), lw * 2);
        const isSel = sel && sel.kind === 'edge' && sel.id === key;
        out.push(`<path d="${d}" class="edge-hit${isSel ? ' selected' : ''}" fill="none" stroke="${isSel ? '#2f7cf6' : 'transparent'}" stroke-opacity="${isSel ? 0.45 : 0}" stroke-width="${lw * 2.6}" stroke-linecap="round" data-kind="edge" data-id="${esc(key)}"/>`);
      }
      out.push('</g>');
    }

    // Interchange outlines are drawn in two passes (black, then white) so circles,
    // station complexes and internal connectors merge into one shape like on the TfL map.
    const RO = S.markerRadius || 7.7, RING = S.markerRing || 2.4;
    const BAR_IN = RO * 0.5, BAR_OUT = BAR_IN + RING * 2;
    const bars = [], rings = [];
    // Connectors between stations
    out.push('<g class="connectors">');
    for (const c of doc.connectors) {
      const SA = idx.stations.get(c.a), SB = idx.stations.get(c.b);
      if (!SA || !SB) continue;
      const A = c.da ? { x: r1(SA.x + c.da[0]), y: r1(SA.y + c.da[1]) } : SA;
      const B = c.db ? { x: r1(SB.x + c.db[0]), y: r1(SB.y + c.db[1]) } : SB;
      const isSel = sel && sel.kind === 'connector' && sel.id === c.id;
      if (c.type === 'internal') {
        bars.push({ a: [A.x, A.y], b: [B.x, B.y], sel: isSel });
      } else {
        out.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${isSel ? '#2f7cf6' : '#000'}" stroke-width="3.6" stroke-dasharray="2.2 2.2" data-kind="connector" data-id="${esc(c.id)}"/>`);
      }
      if (editing) {
        out.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="transparent" stroke-width="10" data-kind="connector" data-id="${esc(c.id)}"/>`);
      }
    }
    out.push('</g>');

    // Stations: markers, labels and icons
    const markers = [], labels = [], hits = [], icons = [], walkLines = [], boxes = [];
    for (const st of doc.stations) {
      const P = [st.x, st.y];
      const lids = [...(idx.stationLines.get(st.id) || [])];
      const inter = D.isInterchange(st, idx);
      const m = labelMetrics(st, S);
      // label direction (centre of label relative to station) for tick orientation
      const lcx = st.label.dx + (st.label.anchor === 'start' ? m.maxW / 2 : st.label.anchor === 'end' ? -m.maxW / 2 : 0);
      const lcy = st.label.dy - m.size * 0.35 + (m.lines.length - 1) * m.lh / 2;
      const labelDir = unit([lcx, lcy]);
      let markerR = 0;

      const iconHere = st.markerIcon && st.stepFree && st.stepFree !== 'none' && S.showIcons;
      // further circles/icons of a station complex and how TfL joins them
      const mpts = [P, ...(st.extra || []).map(ex => [ex.x, ex.y])];
      const links = st.links || (st.extra || []).map((ex, i) => [0, i + 1, 'bar']);
      for (const [i, j, type] of links) {
        if (!mpts[i] || !mpts[j]) continue;
        if (type === 'walk') walkLines.push(`<line x1="${r1(mpts[i][0])}" y1="${r1(mpts[i][1])}" x2="${r1(mpts[j][0])}" y2="${r1(mpts[j][1])}" stroke="${S.markerColor || '#000'}" stroke-width="3.6" stroke-dasharray="2.2 2.2"/>`);
        else bars.push({ a: mpts[i], b: mpts[j], closed: st.closed });
      }
      for (const ex of st.extra || []) {
        if (ex.kind === 'train' || ex.kind === 'platform') icons.push(SYMBOLS['step-free-' + ex.kind].draw(ex.x, ex.y, RO / 7));
        else if (ex.kind === 'pier') icons.push(SYMBOLS['river-near'].draw(ex.x, ex.y, RO / 7));
        else rings.push({ c: [ex.x, ex.y], r: RO, closed: st.closed });
      }
      if (iconHere) {
        icons.push(SYMBOLS['step-free-' + st.stepFree].draw(st.x, st.y, RO / 7));
        markerR = RO;
      } else if (inter || (st.extra && st.extra.length)) {
        // grow the circle to cover parallel lines running through
        let spread = 0;
        for (const nb of idx.neighbours.get(st.id) || []) {
          const offs = geo.offsets.get(D.edgeKey(st.id, nb));
          const e = doc.edges[D.edgeKey(st.id, nb)];
          if (offs && !(e && e.lines)) for (const v of offs.values()) spread = Math.max(spread, Math.abs(v));
        }
        markerR = Math.max(RO, spread + lw * 0.5 + RING);
        rings.push({ c: P, r: markerR, closed: st.closed });
      } else if (lids.length >= 1) {
        // tick on the label side, drawn on the outermost line
        let best = null;
        for (const lid of lids) {
          const nbs = (idx.lineNeighbours.get(st.id) || new Map()).get(lid);
          if (!nbs || !nbs.size) continue;
          const nb = [...nbs][0];
          const pts = linePoints(doc, idx, geo, lid, st.id, nb);
          const t = unit(sub(pts[1], pts[0]));
          let n = [-t[1], t[0]];
          if (n[0] * labelDir[0] + n[1] * labelDir[1] < 0) n = [-n[0], -n[1]];
          const off = sub(pts[0], P);
          const proj = off[0] * n[0] + off[1] * n[1];
          if (!best || proj > best.proj) best = { lid, n, proj, start: pts[0] };
        }
        const tl = S.tickLength || (lw * 0.5 + 5.5);
        if (best) {
          const line = idx.lines.get(best.lid);
          const e0 = [best.start[0] + best.n[0] * tl, best.start[1] + best.n[1] * tl];
          markers.push(`<line x1="${r1(best.start[0])}" y1="${r1(best.start[1])}" x2="${r1(e0[0])}" y2="${r1(e0[1])}" stroke="${esc(st.closed ? '#999' : line.color)}" stroke-width="${r1(S.tickWidth || lw * 0.72)}"/>`);
          markerR = tl;
        } else {
          markers.push(`<circle cx="${st.x}" cy="${st.y}" r="5" fill="#fff" stroke="${NAVY}" stroke-width="2"/>`);
          markerR = 5;
        }
      } else {
        markers.push(`<circle cx="${st.x}" cy="${st.y}" r="5" fill="#fff" stroke="${NAVY}" stroke-width="2" stroke-dasharray="2 2"/>`);
        markerR = 5;
      }
      if (st.closed) markers.push(SYMBOLS.closed.draw(st.x + labelDir[0] * (markerR + 8), st.y + labelDir[1] * (markerR + 8), 0.8));

      // Label
      if (S.showLabels && !st.hideLabel) {
        const lx = st.x + st.label.dx, ly = st.y + st.label.dy;
        if (st.labelBox) {
          // "Station in both fare zones": white box with a grey border (under the markers)
          const b = st.labelBox;
          boxes.push(`<rect x="${r1(st.x + b.dx)}" y="${r1(st.y + b.dy)}" width="${r1(b.w)}" height="${r1(b.h)}" fill="#fff" stroke="#d3d2d2" stroke-width="1.6"/>`);
        }
        const fill = st.closed ? '#9a9a9a' : esc(S.labelColor);
        const tspans = m.lines.map((t, i) => `<tspan x="${r1(lx)}" ${i ? `dy="${r1(m.lh)}"` : ''}>${esc(t)}</tspan>`).join('');
        labels.push(`<text x="${r1(lx)}" y="${r1(ly)}" font-size="${r1(m.size)}" font-family="${esc(S.font)}" font-weight="500" fill="${fill}" text-anchor="${st.label.anchor}" data-kind="label" data-id="${esc(st.id)}"${st.closed ? ' font-style="italic"' : ''}>${tspans}</text>`);

        // Icons in the label row
        const rowIcons = S.showIcons ? stationIcons(st).filter(ic => !((st.markerIcon || S.stepFreeInline === false) && ic.startsWith('step-free')) && !(st.railIcon && ic === 'national-rail')) : [];
        if (S.showIcons && st.nationalRail && st.railIcon) labels.push(SYMBOLS['national-rail'].draw(st.x + st.railIcon.dx, st.y + st.railIcon.dy, 0.78));
        // pictograms placed exactly where TfL put them
        for (const ic of (S.showIcons && st.placedIcons) || []) {
          if (SYMBOLS[ic.type]) labels.push(SYMBOLS[ic.type].draw(st.x + ic.dx, st.y + ic.dy, ic.w / ((FIT && FIT[ic.type]) || ic.w)));
        }
        if (S.inlineIcons === false) rowIcons.length = 0;
        if (rowIcons.length) {
          const lastI = m.lines.length - 1;
          const iy = ly + lastI * m.lh - m.size * 0.36;
          let ix;
          if (st.label.anchor === 'end') {
            ix = lx - m.widths[lastI] - 4;
            for (const ic of rowIcons) {
              const w = ICON_W[ic] || 14;
              labels.push(SYMBOLS[ic].draw(ix - w / 2, iy, 0.82));
              ix -= w + 2;
            }
          } else {
            const w0 = m.widths[lastI];
            ix = (st.label.anchor === 'middle' ? lx + w0 / 2 : lx + w0) + 4;
            for (const ic of rowIcons) {
              const w = ICON_W[ic] || 14;
              labels.push(SYMBOLS[ic].draw(ix + w / 2, iy, 0.82));
              ix += w + 2;
            }
          }
        }
      }

      if (editing) {
        const isSel = sel && sel.kind === 'station' && sel.id === st.id;
        const multi = opts.multi && opts.multi.has(st.id);
        if (isSel || multi) {
          hits.push(`<circle cx="${st.x}" cy="${st.y}" r="${r1(Math.max(markerR, 7) + 5)}" fill="none" stroke="#2f7cf6" stroke-width="2.2" stroke-dasharray="4 3" pointer-events="none"/>`);
        }
        hits.push(`<circle cx="${st.x}" cy="${st.y}" r="${r1(Math.max(markerR, 7) + 2)}" fill="transparent" data-kind="station" data-id="${esc(st.id)}" class="station-hit"/>`);
      }
    }
    const ringCol = c => (c ? '#999' : (S.markerColor || '#000'));
    const outline = [];
    for (const b of bars) outline.push(`<line x1="${r1(b.a[0])}" y1="${r1(b.a[1])}" x2="${r1(b.b[0])}" y2="${r1(b.b[1])}" stroke="${b.sel ? '#2f7cf6' : ringCol(b.closed)}" stroke-width="${r1(BAR_OUT)}"/>`);
    for (const g of rings) outline.push(`<circle cx="${r1(g.c[0])}" cy="${r1(g.c[1])}" r="${r1(g.r)}" fill="${ringCol(g.closed)}"/>`);
    for (const b of bars) outline.push(`<line x1="${r1(b.a[0])}" y1="${r1(b.a[1])}" x2="${r1(b.b[0])}" y2="${r1(b.b[1])}" stroke="#fff" stroke-width="${r1(BAR_IN)}"/>`);
    for (const g of rings) outline.push(`<circle cx="${r1(g.c[0])}" cy="${r1(g.c[1])}" r="${r1(g.r - RING)}" fill="#fff"/>`);
    out.push('<g class="boxes">', ...boxes, '</g>');
    out.push('<g class="markers">', ...walkLines, ...markers, ...outline, ...icons, '</g>');
    out.push('<g class="labels">', ...labels, '</g>');

    // Free symbols and text
    out.push('<g class="symbols">');
    for (const s of doc.symbols) {
      const def = SYMBOLS[s.type];
      if (!def) continue;
      const isSel = sel && sel.kind === 'symbol' && sel.id === s.id;
      out.push(`<g data-kind="symbol" data-id="${esc(s.id)}">${def.draw(s.x, s.y, s.scale || 1)}` +
        (editing ? `<circle cx="${s.x}" cy="${s.y}" r="${12 * (s.scale || 1)}" fill="transparent" stroke="${isSel ? '#2f7cf6' : 'none'}" stroke-width="2" stroke-dasharray="3 3"/>` : '') + '</g>');
    }
    for (const t of doc.texts) if (!t.back) out.push(textMarkup(t, S, sel));
    out.push('</g>');

    if (S.showKey && doc.key.visible && !opts.hideKey) out.push(renderKey(doc, idx, opts));

    if (doc.title && opts.showTitle !== false) {
      out.push(`<text x="${doc.width - 24}" y="${doc.height - 22}" text-anchor="end" font-size="22" font-weight="bold" fill="${NAVY}" font-family="${esc(S.font)}" data-kind="title">${esc(doc.title)}</text>`);
    }

    if (editing) {
      out.push('<g class="hits">', ...hits, '</g>');
      // handles for selected zone / river
      if (sel && sel.kind === 'zone') {
        const z = doc.zones.find(z => z.id === sel.id);
        if (z && z.points.length) {
          out.push(`<polygon points="${z.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="#2f7cf6" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`);
          z.points.forEach((p, i) => out.push(`<circle cx="${p[0]}" cy="${p[1]}" r="7" class="handle" data-kind="zone-handle" data-id="${esc(z.id)}" data-i="${i}"/>`));
        }
      }
      if (sel && sel.kind === 'river') {
        doc.river.points.forEach((p, i) => out.push(`<circle cx="${p[0]}" cy="${p[1]}" r="6" class="handle" data-kind="river-handle" data-i="${i}"/>`));
      }
      if (sel && sel.kind === 'edge') {
        const e = doc.edges[sel.id];
        if (e && e.via && (e.shape || 'auto') === 'auto') {
          e.via.forEach((p, i) => out.push(`<circle cx="${p[0]}" cy="${p[1]}" r="5" class="handle" data-kind="via-handle" data-id="${esc(sel.id)}" data-i="${i}"/>`));
        }
      }
      if (opts.preview) {
        const p = opts.preview;
        out.push(`<line x1="${p.from[0]}" y1="${p.from[1]}" x2="${p.to[0]}" y2="${p.to[1]}" stroke="${esc(p.color || '#2f7cf6')}" stroke-width="${lw}" stroke-opacity="0.55" stroke-dasharray="6 4" pointer-events="none"/>`);
      }
    }
    return out.join('\n');
  }

  function textMarkup(t, S, sel) {
    const isSel = sel && sel.kind === 'text' && sel.id === t.id;
    const lines = String(t.text).split('\n');
    const size = t.size || 16;
    const tsp = lines.map((ln, i) => `<tspan x="${t.x}" ${i ? `dy="${size * 1.15}"` : ''}>${esc(ln)}</tspan>`).join('');
    return `<text x="${t.x}" y="${t.y}" font-size="${size}" font-family="${esc(S.font)}" font-weight="${t.bold ? 'bold' : 'normal'}" fill="${esc(t.color || NAVY)}" text-anchor="${t.anchor || 'start'}" data-kind="text" data-id="${esc(t.id)}"${isSel ? ' text-decoration="underline"' : ''}>${tsp}</text>`;
  }

  function gridDefs(grid) {
    return `<defs><pattern id="grid" width="${grid * 5}" height="${grid * 5}" patternUnits="userSpaceOnUse">
      <path d="M ${grid * 5} 0 L 0 0 0 ${grid * 5}" fill="none" stroke="#c7d2e6" stroke-width="1"/>
      ${[1, 2, 3, 4].map(i => `<path d="M ${grid * i} 0 V ${grid * 5} M 0 ${grid * i} H ${grid * 5}" stroke="#e7ecf5" stroke-width="0.6"/>`).join('')}
    </pattern></defs>`;
  }

  /** Complete standalone SVG document string (for export). */
  function renderSVG(doc, opts = {}) {
    const scale = opts.scale || 1;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width * scale}" height="${doc.height * scale}" viewBox="0 0 ${doc.width} ${doc.height}">` +
      (opts.fontCSS ? `<defs><style>${opts.fontCSS}</style></defs>` : '') +
      renderInner(doc, Object.assign({}, opts, { editing: false })) + '</svg>';
  }

  window.TubeRender = { renderInner, renderSVG, gridDefs, roundedPath, textWidth };
})();
