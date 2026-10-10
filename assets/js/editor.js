/* TubeMaker editor: tools, selection, properties panel, history, autosave and publishing. */
(function () {
  const D = window.TubeDoc, R = window.TubeRender, X = window.TubeExport, API = window.TubeAPI;
  const { SYMBOLS } = window.TubeSymbols;
  const AUTOSAVE_KEY = 'tubemaker.autosave';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const svg = $('#canvas');
  const viewport = $('#viewport');
  const wrap = $('#canvasWrap');

  const state = {
    doc: null,
    selection: null,          // {kind, id}
    multi: new Set(),         // extra selected station ids
    tool: 'select',
    activeLineId: null,
    drawing: null,            // {lineId, bi, last}
    connectorStart: null,
    connectorType: 'walk',
    symbolType: 'step-free-train',
    view: { x: 0, y: 0, k: 0.5 },
    pointer: null,            // world coords of pointer
    drag: null,
    spaceDown: false,
    history: [],
    future: [],
  };

  /* ------------------------------------------------------------------ utils */

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  function status(msg) { $('#status').textContent = msg; }

  function snap(v) {
    const S = state.doc.settings;
    return S.snap ? Math.round(v / (S.grid / 2)) * (S.grid / 2) : Math.round(v * 10) / 10;
  }

  const ODIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  /** Snap p onto the nearest horizontal/vertical/45-degree ray from `from`, on the grid. */
  function snapRay(from, p) {
    const g = state.doc.settings.snap ? state.doc.settings.grid / 2 : 1;
    let best = null;
    for (const [cx, cy] of ODIRS) {
      const l = Math.hypot(cx, cy);
      const t = ((p[0] - from[0]) * cx + (p[1] - from[1]) * cy) / (l * l); // steps along (cx, cy)
      const k = Math.round(t / g) * g;
      const q = [from[0] + cx * k, from[1] + cy * k];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = { q, d };
    }
    return best.q;
  }

  /**
   * While dragging a single station, pull it into line (0/45/90 degrees) with its
   * neighbours when it gets close; prefer a spot that lines up with two of them.
   */
  function alignToNeighbours(id, p) {
    if (state.doc.settings.octilinear === false) return p;
    const idx = D.buildIndex(state.doc);
    const nbs = [...(idx.neighbours.get(id) || [])].map(n => idx.stations.get(n)).filter(Boolean);
    if (!nbs.length) return p;
    const tol = 10 / state.view.k;
    const rays = [];
    for (const n of nbs) for (const d of ODIRS) rays.push({ n, d });
    let best = null;
    const consider = (q, score) => {
      const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dist < tol && (!best || score + dist < best.s)) best = { q, s: score + dist };
    };
    for (let i = 0; i < rays.length; i++) {
      const { n, d } = rays[i];
      const l2 = d[0] * d[0] + d[1] * d[1];
      const t = ((p[0] - n.x) * d[0] + (p[1] - n.y) * d[1]) / l2;
      consider([n.x + d[0] * t, n.y + d[1] * t], 0);
      for (let j = i + 1; j < rays.length; j++) {
        const r = rays[j];
        if (r.n === n) continue;
        const det = d[0] * -r.d[1] - d[1] * -r.d[0];
        if (Math.abs(det) < 1e-9) continue;
        const bx = r.n.x - n.x, by = r.n.y - n.y;
        const s1 = (bx * -r.d[1] - by * -r.d[0]) / det;
        consider([n.x + d[0] * s1, n.y + d[1] * s1], -tol); // lining up with two neighbours wins
      }
    }
    return best ? best.q.map(v => Math.round(v * 10) / 10) : p;
  }

  function worldPoint(evt) {
    const r = svg.getBoundingClientRect();
    const v = state.view;
    return [(evt.clientX - r.left - v.x) / v.k, (evt.clientY - r.top - v.y) / v.k];
  }

  function stationById(id) { return state.doc.stations.find(s => s.id === id); }
  function lineById(id) { return state.doc.lines.find(l => l.id === id); }
  function activeLine() { return lineById(state.activeLineId); }

  function slugify(name) {
    return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'station';
  }
  function uniqueStationId(name) {
    const base = slugify(name);
    let id = base, i = 2;
    const ids = new Set(state.doc.stations.map(s => s.id));
    while (ids.has(id)) id = `${base}-${i++}`;
    return id;
  }

  /* ---------------------------------------------------------------- history */

  function snapshot() { return JSON.stringify(state.doc); }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 150) state.history.shift();
    state.future = [];
  }
  function undo() {
    if (!state.history.length) return toast('Nothing to undo');
    state.future.push(snapshot());
    state.doc = JSON.parse(state.history.pop());
    afterDocReplaced(false);
  }
  function redo() {
    if (!state.future.length) return toast('Nothing to redo');
    state.history.push(snapshot());
    state.doc = JSON.parse(state.future.pop());
    afterDocReplaced(false);
  }

  function afterDocReplaced(resetView) {
    if (state.selection && !selectionExists(state.selection)) state.selection = null;
    state.multi = new Set([...state.multi].filter(id => stationById(id)));
    if (!lineById(state.activeLineId)) state.activeLineId = state.doc.lines[0] ? state.doc.lines[0].id : null;
    state.drawing = null;
    state.connectorStart = null;
    $('#docTitle').value = state.doc.title;
    updateGridDefs();
    if (resetView) fitView();
    changed(false);
  }

  function selectionExists(sel) {
    const d = state.doc;
    switch (sel.kind) {
      case 'station': return !!stationById(sel.id);
      case 'line': return !!lineById(sel.id);
      case 'edge': return D.buildIndex(d).edgeLines.has(sel.id);
      case 'connector': return d.connectors.some(c => c.id === sel.id);
      case 'symbol': return d.symbols.some(s => s.id === sel.id);
      case 'text': return d.texts.some(t => t.id === sel.id);
      case 'zone': return d.zones.some(z => z.id === sel.id);
      default: return true;
    }
  }

  /* ----------------------------------------------------------- render loop */

  let rafPending = false, panelDirty = true, saveTimer = null;

  function changed(save = true, panel = true) {
    if (panel) panelDirty = true;
    requestRender();
    if (save) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(autosave, 700);
    }
  }

  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  function render() {
    let preview = null;
    if (state.tool === 'line' && state.drawing && state.pointer) {
      const st = stationById(state.drawing.last);
      const l = lineById(state.drawing.lineId);
      if (st && l) preview = { from: [st.x, st.y], to: linePlacement(state.pointer, state.lastEvt), color: l.color };
    }
    if (state.tool === 'connector' && state.connectorStart && state.pointer) {
      const st = stationById(state.connectorStart);
      if (st) preview = { from: [st.x, st.y], to: state.pointer, color: '#000' };
    }
    viewport.innerHTML = R.renderInner(state.doc, {
      editing: true, selection: state.selection, preview, multi: state.multi,
    }) + (state.drag && state.drag.type === 'box' ? boxMarkup(state.drag) : '');
    applyView();
    if (panelDirty) {
      panelDirty = false;
      renderLineList();
      renderProps();
    }
  }

  function boxMarkup(d) {
    const x = Math.min(d.start[0], d.cur[0]), y = Math.min(d.start[1], d.cur[1]);
    const w = Math.abs(d.cur[0] - d.start[0]), h = Math.abs(d.cur[1] - d.start[1]);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(47,124,246,0.08)" stroke="#2f7cf6" stroke-dasharray="5 4" stroke-width="${1.5 / state.view.k}" pointer-events="none"/>`;
  }

  function applyView() {
    const v = state.view;
    viewport.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
    $('#zoomLevel').textContent = Math.round(v.k * 100) + '%';
  }

  function updateGridDefs() {
    let defs = svg.querySelector('defs');
    if (defs) defs.remove();
    svg.insertAdjacentHTML('afterbegin', R.gridDefs(state.doc.settings.grid));
  }

  function fitView() {
    const r = wrap.getBoundingClientRect();
    const d = state.doc;
    const k = Math.min((r.width - 40) / d.width, (r.height - 40) / d.height);
    state.view = { k, x: (r.width - d.width * k) / 2, y: (r.height - d.height * k) / 2 };
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    const v = state.view;
    const k = Math.min(8, Math.max(0.08, v.k * factor));
    const f = k / v.k;
    v.x = cx - (cx - v.x) * f;
    v.y = cy - (cy - v.y) * f;
    v.k = k;
    applyView();
  }

  /* --------------------------------------------------------------- autosave */

  function autosave() {
    try { localStorage.setItem(AUTOSAVE_KEY, snapshot()); } catch (e) { /* quota or disabled */ }
    status('Saved in this browser ' + new Date().toLocaleTimeString());
  }

  function loadDoc(doc, resetHistory = true) {
    state.doc = D.normalize(doc);
    if (resetHistory) { state.history = []; state.future = []; }
    state.selection = null;
    state.multi.clear();
    state.activeLineId = state.doc.lines[0] ? state.doc.lines[0].id : null;
    afterDocReplaced(true);
    autosave();
  }

  /* --------------------------------------------------------------- editing */

  function addStation(x, y, name) {
    const n = state.doc.stations.length + 1;
    name = name || `New Station ${n}`;
    const st = {
      id: uniqueStationId(name), name, x: snap(x), y: snap(y),
      label: { lines: [name], dx: 0, dy: 0, anchor: 'start' },
      nationalRail: false, airport: false, river: 'none', coach: false, stepFree: 'none', interchange: 'auto', closed: false,
    };
    setLabelPos(st, 'E');
    state.doc.stations.push(st);
    return st;
  }

  function setLabelPos(st, pos) {
    const S = state.doc.settings;
    const size = S.labelSize * (st.labelScale || 1);
    const lh = size * 1.12;
    const n = Math.max(1, st.label.lines.length);
    const g = 11;
    const g2 = g * 0.75;
    const mid = size * 0.35 - (n - 1) * lh / 2;
    const above = -g - (n - 1) * lh;
    const below = g + size * 0.75;
    const map = {
      E: [g, mid, 'start'], W: [-g, mid, 'end'],
      N: [0, above, 'middle'], S: [0, below, 'middle'],
      NE: [g2, -g2 - (n - 1) * lh, 'start'], NW: [-g2, -g2 - (n - 1) * lh, 'end'],
      SE: [g2, g2 + size * 0.75, 'start'], SW: [-g2, g2 + size * 0.75, 'end'],
    };
    const [dx, dy, anchor] = map[pos] || map.E;
    st.label.dx = Math.round(dx * 10) / 10;
    st.label.dy = Math.round(dy * 10) / 10;
    st.label.anchor = anchor;
    st.labelPos = pos;
  }

  function deleteStation(id) {
    const d = state.doc;
    d.stations = d.stations.filter(s => s.id !== id);
    for (const l of d.lines) {
      l.branches = l.branches.map(b => b.filter(s => s !== id)).filter(b => b.length > 0);
    }
    for (const k of Object.keys(d.edges)) if (k.split('|').includes(id)) delete d.edges[k];
    d.connectors = d.connectors.filter(c => c.a !== id && c.b !== id);
    state.multi.delete(id);
    if (state.drawing && state.drawing.last === id) state.drawing = null;
  }

  function deleteEdge(key) {
    const [a, b] = key.split('|');
    for (const l of state.doc.lines) {
      const out = [];
      for (const br of l.branches) {
        let cur = [];
        for (let i = 0; i < br.length; i++) {
          if (i > 0 && D.edgeKey(br[i - 1], br[i]) === key) {
            if (cur.length > 1) out.push(cur);
            cur = [];
          }
          cur.push(br[i]);
        }
        if (cur.length > 1) out.push(cur);
      }
      l.branches = out;
    }
    delete state.doc.edges[key];
    void a; void b;
  }

  /** Put a new station in the middle of a segment, on every line using it. */
  function splitEdge(key) {
    const [a, b] = key.split('|');
    const idx = D.buildIndex(state.doc);
    const pts = D.edgePoints(state.doc, idx, a, b);
    // midpoint along the polyline
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
    let half = total / 2, mid = pts[0], cut = 1;
    for (let i = 0; i < segs.length; i++) {
      if (half <= segs[i]) {
        const t = segs[i] ? half / segs[i] : 0;
        mid = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
        cut = i + 1;
        break;
      }
      half -= segs[i];
    }
    const st = addStation(mid[0], mid[1]);
    st.x = Math.round(mid[0] * 10) / 10; st.y = Math.round(mid[1] * 10) / 10;
    const e = state.doc.edges[key];
    if (e && e.via && e.via.length && (e.shape || 'auto') === 'auto') {
      // pts are oriented a->b and a < b, so via order matches
      const viaA = pts.slice(1, cut), viaB = pts.slice(cut, pts.length - 1);
      if (viaA.length) state.doc.edges[D.edgeKey(a, st.id)] = { via: a < st.id ? viaA : viaA.slice().reverse() };
      if (viaB.length) state.doc.edges[D.edgeKey(st.id, b)] = { via: st.id < b ? viaB : viaB.slice().reverse() };
    }
    delete state.doc.edges[key];
    for (const l of state.doc.lines) {
      for (const br of l.branches) {
        for (let i = br.length - 1; i > 0; i--) {
          if (D.edgeKey(br[i - 1], br[i]) === key) br.splice(i, 0, st.id);
        }
      }
    }
    return st;
  }

  function deleteSelection() {
    const sel = state.selection;
    if (!sel && !state.multi.size) return;
    pushHistory();
    const d = state.doc;
    for (const id of state.multi) deleteStation(id);
    state.multi.clear();
    if (sel) {
      switch (sel.kind) {
        case 'station': deleteStation(sel.id); break;
        case 'edge': deleteEdge(sel.id); break;
        case 'connector': d.connectors = d.connectors.filter(c => c.id !== sel.id); break;
        case 'symbol': d.symbols = d.symbols.filter(s => s.id !== sel.id); break;
        case 'text': d.texts = d.texts.filter(t => t.id !== sel.id); break;
        case 'zone': d.zones = d.zones.filter(z => z.id !== sel.id); break;
        case 'line': deleteLine(sel.id); break;
        case 'key': d.key.visible = false; break;
        case 'river': d.river.points = []; break;
      }
    }
    state.selection = null;
    changed();
  }

  function deleteLine(id) {
    state.doc.lines = state.doc.lines.filter(l => l.id !== id);
    if (state.activeLineId === id) state.activeLineId = state.doc.lines[0] ? state.doc.lines[0].id : null;
    if (state.drawing && state.drawing.lineId === id) state.drawing = null;
  }

  function eraseTarget(kind, id, el) {
    const d = state.doc;
    pushHistory();
    switch (kind) {
      case 'station': case 'label': deleteStation(id); break;
      case 'edge': deleteEdge(id); break;
      case 'connector': d.connectors = d.connectors.filter(c => c.id !== id); break;
      case 'symbol': d.symbols = d.symbols.filter(s => s.id !== id); break;
      case 'text': d.texts = d.texts.filter(t => t.id !== id); break;
      case 'zone': d.zones = d.zones.filter(z => z.id !== id); break;
      case 'zone-handle': {
        const z = d.zones.find(z => z.id === id);
        if (z && z.points.length > 3) z.points.splice(+el.dataset.i, 1);
        break;
      }
      case 'river-handle': d.river.points.splice(+el.dataset.i, 1); break;
      case 'via-handle': { const e = d.edges[id]; if (e && e.via) e.via.splice(+el.dataset.i, 1); break; }
      default: state.history.pop(); return;
    }
    if (state.selection && !selectionExists(state.selection)) state.selection = null;
    changed();
  }

  /* ------------------------------------------------------------ line tool */

  function lineToolClick(stId) {
    const line = activeLine();
    if (!line) { toast('Add or choose a line first (left panel)'); return; }
    pushHistory();
    if (!state.drawing || state.drawing.lineId !== line.id) {
      let bi = line.branches.findIndex(b => b[b.length - 1] === stId);
      if (bi < 0) {
        bi = line.branches.findIndex(b => b[0] === stId);
        if (bi >= 0) line.branches[bi].reverse();
      }
      if (bi < 0) { line.branches.push([stId]); bi = line.branches.length - 1; }
      state.drawing = { lineId: line.id, bi, last: stId };
      status(`Drawing ${line.name}: click the next station (Esc to finish)`);
    } else {
      if (stId === state.drawing.last) { finishDrawing(); return; }
      const br = line.branches[state.drawing.bi];
      if (!br) { state.drawing = null; return; }
      br.push(stId);
      state.drawing.last = stId;
    }
    state.selection = { kind: 'station', id: stId };
    changed();
  }

  /** Where a click with the line tool puts a new station (kept at 0/45/90 degrees; Alt = free). */
  function linePlacement(p, evt) {
    const last = state.drawing && stationById(state.drawing.last);
    if (!last || (evt && evt.altKey) || state.doc.settings.octilinear === false) return [snap(p[0]), snap(p[1])];
    return snapRay([last.x, last.y], p);
  }

  function finishDrawing() {
    if (!state.drawing) return;
    const line = lineById(state.drawing.lineId);
    if (line) line.branches = line.branches.filter(b => b.length > 1);
    state.drawing = null;
    status('Finished branch');
    changed();
  }

  /* ---------------------------------------------------------- pointer input */

  function targetOf(evt) {
    const el = evt.target.closest && evt.target.closest('[data-kind]');
    if (!el) return { kind: 'bg', id: null, el: null };
    return { kind: el.dataset.kind, id: el.dataset.id || null, el };
  }

  function select(sel, additive = false) {
    if (additive && sel && sel.kind === 'station') {
      if (state.selection && state.selection.kind === 'station') state.multi.add(state.selection.id);
      if (state.multi.has(sel.id)) state.multi.delete(sel.id); else state.multi.add(sel.id);
      state.selection = null;
    } else {
      state.multi.clear();
      state.selection = sel;
    }
    if (sel && sel.kind === 'line') state.activeLineId = sel.id;
    changed(false);
  }

  /** Remember edge bends so they can follow moving stations. */
  function captureEdgesFor(ids) {
    const set = new Set(ids);
    const edges = [];
    for (const [k, e] of Object.entries(state.doc.edges)) {
      if (!e.via || !e.via.length) continue;
      const [a, b] = k.split('|');
      if (!set.has(a) && !set.has(b)) continue;
      const A = stationById(a), B = stationById(b);
      if (!A || !B) continue;
      const pts = [[A.x, A.y], ...e.via, [B.x, B.y]];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1] || 1;
      edges.push({ key: k, a, b, via: e.via.map(p => p.slice()), t: e.via.map((_, i) => cum[i + 1] / total) });
    }
    return edges;
  }

  function onPointerDown(evt) {
    if (evt.button === 2) return;
    svg.setPointerCapture(evt.pointerId);
    const p = worldPoint(evt);
    const t = targetOf(evt);
    const d = state.doc;

    const panRequested = evt.button === 1 || state.spaceDown || state.tool === 'pan';
    if (panRequested) {
      state.drag = { type: 'pan', sx: evt.clientX, sy: evt.clientY, vx: state.view.x, vy: state.view.y };
      wrap.classList.add('panning');
      return;
    }

    const empty = ['bg', 'zone', 'river', 'title'].includes(t.kind);

    switch (state.tool) {
      case 'select': {
        if (t.kind === 'station' || t.kind === 'label') {
          if (evt.shiftKey) { select({ kind: 'station', id: t.id }, true); return; }
          const already = state.multi.has(t.id);
          if (!already) select({ kind: 'station', id: t.id });
          const ids = already ? [...state.multi] : [t.id];
          if (t.kind === 'label' && !already) {
            const st = stationById(t.id);
            state.drag = { type: 'label', id: t.id, start: p, dx: st.label.dx, dy: st.label.dy, moved: false };
          } else {
            state.drag = {
              type: 'stations', start: p, moved: false,
              orig: ids.map(id => { const s = stationById(id); return { id, x: s.x, y: s.y }; }),
              edges: captureEdgesFor(ids),
            };
          }
          return;
        }
        if (t.kind === 'symbol' || t.kind === 'text') {
          select({ kind: t.kind, id: t.id });
          const obj = (t.kind === 'symbol' ? d.symbols : d.texts).find(o => o.id === t.id);
          state.drag = { type: 'object', obj, start: p, ox: obj.x, oy: obj.y, moved: false };
          return;
        }
        if (t.kind === 'key') {
          select({ kind: 'key', id: 'key' });
          state.drag = { type: 'object', obj: d.key, start: p, ox: d.key.x, oy: d.key.y, moved: false };
          return;
        }
        if (t.kind === 'zone-handle' || t.kind === 'river-handle' || t.kind === 'via-handle') {
          let pts;
          if (t.kind === 'zone-handle') pts = d.zones.find(z => z.id === t.id).points;
          else if (t.kind === 'river-handle') pts = d.river.points;
          else pts = d.edges[t.id].via;
          const i = +t.el.dataset.i;
          state.drag = { type: 'point', pts, i, start: p, ox: pts[i][0], oy: pts[i][1], moved: false };
          return;
        }
        if (t.kind === 'edge' || t.kind === 'connector') { select({ kind: t.kind, id: t.id }); return; }
        if (evt.shiftKey) {
          state.drag = { type: 'box', start: p, cur: p };
          return;
        }
        // background, zone or river: pan on drag, select on click
        state.drag = { type: 'pan', sx: evt.clientX, sy: evt.clientY, vx: state.view.x, vy: state.view.y, click: t, clickPoint: p };
        wrap.classList.add('panning');
        return;
      }
      case 'station': {
        if (t.kind === 'station' || t.kind === 'label') { select({ kind: 'station', id: t.id }); return; }
        pushHistory();
        const st = addStation(p[0], p[1]);
        select({ kind: 'station', id: st.id });
        changed();
        setTimeout(() => { const n = $('#propName'); if (n) { n.focus(); n.select(); } }, 30);
        return;
      }
      case 'line': {
        if (t.kind === 'station' || t.kind === 'label') { lineToolClick(t.id); return; }
        if (t.kind === 'edge' && !state.drawing) {
          // clicking a segment with the line tool adds a station in it
          pushHistory();
          const st = splitEdge(t.id);
          select({ kind: 'station', id: st.id });
          changed();
          return;
        }
        if (empty || t.kind === 'edge') {
          if (!activeLine()) { toast('Add or choose a line first (left panel)'); return; }
          pushHistory();
          const q = linePlacement(p, evt);
          const st = addStation(q[0], q[1]);
          st.x = q[0]; st.y = q[1];
          state.history.pop(); // lineToolClick records the history step
          lineToolClick(st.id);
        }
        return;
      }
      case 'connector': {
        if (t.kind !== 'station' && t.kind !== 'label') { state.connectorStart = null; changed(false); return; }
        if (!state.connectorStart) {
          state.connectorStart = t.id;
          select({ kind: 'station', id: t.id });
          status('Now click the second station');
        } else if (state.connectorStart !== t.id) {
          pushHistory();
          d.connectors.push({ id: D.uid('c'), a: state.connectorStart, b: t.id, type: state.connectorType });
          state.connectorStart = null;
          status('Connector added');
          changed();
        }
        return;
      }
      case 'symbol': {
        if (t.kind === 'symbol') { select({ kind: 'symbol', id: t.id }); return; }
        pushHistory();
        const s = { id: D.uid('sym'), type: state.symbolType, x: snap(p[0]), y: snap(p[1]), scale: 1 };
        d.symbols.push(s);
        select({ kind: 'symbol', id: s.id });
        changed();
        return;
      }
      case 'text': {
        if (t.kind === 'text') { select({ kind: 'text', id: t.id }); return; }
        const text = prompt('Text to place on the map:', 'Label');
        if (!text) return;
        pushHistory();
        const o = { id: D.uid('txt'), x: snap(p[0]), y: snap(p[1]), text, size: 18, color: '#1c2c6b', bold: false, anchor: 'start' };
        d.texts.push(o);
        select({ kind: 'text', id: o.id });
        changed();
        return;
      }
      case 'erase': {
        if (t.kind === 'label') eraseTarget('station', t.id, t.el);
        else if (!empty || t.kind === 'zone') eraseTarget(t.kind, t.id, t.el);
        return;
      }
    }
  }

  function onPointerMove(evt) {
    const p = worldPoint(evt);
    state.pointer = p;
    state.lastEvt = { altKey: evt.altKey };
    $('#coords').textContent = `${Math.round(p[0])}, ${Math.round(p[1])}`;
    const dr = state.drag;
    if (!dr) {
      if ((state.tool === 'line' && state.drawing) || (state.tool === 'connector' && state.connectorStart)) requestRender();
      return;
    }
    if (dr.type === 'pan') {
      const dx = evt.clientX - dr.sx, dy = evt.clientY - dr.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
      state.view.x = dr.vx + dx;
      state.view.y = dr.vy + dy;
      applyView();
      return;
    }
    if (dr.type === 'box') { dr.cur = p; requestRender(); return; }

    const dx = p[0] - dr.start[0], dy = p[1] - dr.start[1];
    if (!dr.moved) {
      if (Math.hypot(dx, dy) * state.view.k < 3) return;
      pushHistory();
      dr.moved = true;
    }
    if (dr.type === 'stations') {
      const lead = dr.orig[0];
      // snap the lead station, move the others by the same amount
      let target = [snap(lead.x + dx), snap(lead.y + dy)];
      if (dr.orig.length === 1 && !evt.altKey) target = alignToNeighbours(lead.id, [lead.x + dx, lead.y + dy]) || target;
      if (target[0] === lead.x + dx && target[1] === lead.y + dy) target = [snap(lead.x + dx), snap(lead.y + dy)];
      const sx = target[0] - lead.x, sy = target[1] - lead.y;
      const disp = new Map();
      for (const o of dr.orig) {
        const s = stationById(o.id);
        s.x = Math.round((o.x + sx) * 10) / 10;
        s.y = Math.round((o.y + sy) * 10) / 10;
        disp.set(o.id, [sx, sy]);
      }
      for (const e of dr.edges) {
        const da = disp.get(e.a) || [0, 0], db = disp.get(e.b) || [0, 0];
        state.doc.edges[e.key].via = e.via.map((v, i) => [
          Math.round((v[0] + da[0] * (1 - e.t[i]) + db[0] * e.t[i]) * 10) / 10,
          Math.round((v[1] + da[1] * (1 - e.t[i]) + db[1] * e.t[i]) * 10) / 10,
        ]);
      }
      changed(true, false);
    } else if (dr.type === 'label') {
      const st = stationById(dr.id);
      st.label.dx = Math.round((dr.dx + dx) * 10) / 10;
      st.label.dy = Math.round((dr.dy + dy) * 10) / 10;
      st.labelPos = 'custom';
      changed(true, false);
    } else if (dr.type === 'object') {
      dr.obj.x = snap(dr.ox + dx);
      dr.obj.y = snap(dr.oy + dy);
      changed(true, false);
    } else if (dr.type === 'point') {
      dr.pts[dr.i] = [snap(dr.ox + dx), snap(dr.oy + dy)];
      changed(true, false);
    }
  }

  function onPointerUp(evt) {
    const dr = state.drag;
    state.drag = null;
    wrap.classList.remove('panning');
    if (!dr) return;
    if (dr.type === 'pan' && !dr.moved && dr.click) {
      const t = dr.click;
      if (t.kind === 'zone') select({ kind: 'zone', id: t.id });
      else if (t.kind === 'river') select({ kind: 'river', id: 'river' });
      else select(null);
    }
    if (dr.type === 'box') {
      const x0 = Math.min(dr.start[0], dr.cur[0]), x1 = Math.max(dr.start[0], dr.cur[0]);
      const y0 = Math.min(dr.start[1], dr.cur[1]), y1 = Math.max(dr.start[1], dr.cur[1]);
      state.multi = new Set(state.doc.stations.filter(s => s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1).map(s => s.id));
      state.selection = null;
      status(`${state.multi.size} stations selected — drag one to move them together`);
      changed(false);
      return;
    }
    if (dr.moved) changed();
    void evt;
  }

  function onWheel(evt) {
    evt.preventDefault();
    const r = svg.getBoundingClientRect();
    const factor = Math.exp(-evt.deltaY * (evt.ctrlKey ? 0.01 : 0.0015));
    zoomAt(factor, evt.clientX - r.left, evt.clientY - r.top);
  }

  function onDblClick(evt) {
    const t = targetOf(evt);
    if (state.tool === 'select' && (t.kind === 'station' || t.kind === 'label')) {
      const n = $('#propName');
      if (n) { n.focus(); n.select(); }
    }
    if (state.tool === 'select' && t.kind === 'text') {
      const o = state.doc.texts.find(x => x.id === t.id);
      const text = prompt('Edit text', o.text);
      if (text != null) { pushHistory(); o.text = text; changed(); }
    }
  }

  /* -------------------------------------------------------------- keyboard */

  function onKeyDown(evt) {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((evt.ctrlKey || evt.metaKey) && !typing) {
      const k = evt.key.toLowerCase();
      if (k === 'z' && !evt.shiftKey) { evt.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && evt.shiftKey)) { evt.preventDefault(); redo(); return; }
    }
    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 's') { evt.preventDefault(); X.exportJSON(state.doc); return; }
    if (typing) {
      if (evt.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (evt.key === ' ') { state.spaceDown = true; wrap.classList.add('pan-ready'); evt.preventDefault(); return; }
    if (evt.key === 'Escape') {
      if (state.drawing) finishDrawing();
      state.connectorStart = null;
      select(null);
      return;
    }
    if (evt.key === 'Delete' || evt.key === 'Backspace') { evt.preventDefault(); deleteSelection(); return; }
    const tools = { v: 'select', s: 'station', l: 'line', c: 'connector', k: 'symbol', t: 'text', e: 'erase', h: 'pan' };
    if (!evt.ctrlKey && !evt.metaKey && tools[evt.key.toLowerCase()]) { setTool(tools[evt.key.toLowerCase()]); return; }
    if (evt.key === '+' || evt.key === '=') { zoomButton(1.25); return; }
    if (evt.key === '-') { zoomButton(0.8); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[evt.key]) {
      evt.preventDefault();
      const step = evt.shiftKey ? state.doc.settings.grid : 1;
      const [dx, dy] = arrows[evt.key].map(v => v * step);
      nudge(dx, dy);
    }
  }

  function nudge(dx, dy) {
    const ids = [...state.multi];
    const sel = state.selection;
    if (sel && sel.kind === 'station') ids.push(sel.id);
    pushHistory();
    if (ids.length) {
      const edges = captureEdgesFor(ids);
      const set = new Set(ids);
      for (const id of ids) { const s = stationById(id); s.x += dx; s.y += dy; }
      for (const e of edges) {
        const da = set.has(e.a) ? [dx, dy] : [0, 0], db = set.has(e.b) ? [dx, dy] : [0, 0];
        state.doc.edges[e.key].via = e.via.map((v, i) => [v[0] + da[0] * (1 - e.t[i]) + db[0] * e.t[i], v[1] + da[1] * (1 - e.t[i]) + db[1] * e.t[i]]);
      }
    } else if (sel && (sel.kind === 'symbol' || sel.kind === 'text')) {
      const o = (sel.kind === 'symbol' ? state.doc.symbols : state.doc.texts).find(x => x.id === sel.id);
      o.x += dx; o.y += dy;
    } else if (sel && sel.kind === 'key') {
      state.doc.key.x += dx; state.doc.key.y += dy;
    } else { state.history.pop(); return; }
    changed();
  }

  function zoomButton(f) {
    const r = wrap.getBoundingClientRect();
    zoomAt(f, r.width / 2, r.height / 2);
  }

  /* ----------------------------------------------------------------- tools */

  const TOOL_HINTS = {
    select: 'Click to select · drag to move · drag empty space to pan · Shift+drag to box-select stations · scroll to zoom',
    station: 'Click anywhere to add a station',
    line: 'Click stations in order to draw the active line · new stations snap to 45° (hold Alt for free placement) · click a segment to insert a station · Esc to finish',
    connector: 'Click two stations to join them with an interchange connector',
    symbol: 'Choose a key symbol below, then click on the map to place it',
    text: 'Click on the map to add free text',
    erase: 'Click anything to delete it',
    pan: 'Drag to move around the map',
  };

  function setTool(tool) {
    if (state.drawing && tool !== 'line') finishDrawing();
    state.tool = tool;
    state.connectorStart = null;
    $$('#tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    wrap.dataset.tool = tool;
    $('#hint').textContent = TOOL_HINTS[tool] || '';
    renderToolOptions();
    requestRender();
  }

  function renderToolOptions() {
    const box = $('#toolOptions');
    if (state.tool === 'connector') {
      box.innerHTML = `<label>Connector type
        <select id="optConnector"><option value="walk">Walking link (dotted)</option><option value="internal">Internal interchange (blob)</option></select></label>`;
      $('#optConnector').value = state.connectorType;
      $('#optConnector').onchange = e => { state.connectorType = e.target.value; };
    } else if (state.tool === 'symbol') {
      box.innerHTML = '<div class="symbol-grid">' + Object.entries(SYMBOLS).map(([k, v]) =>
        `<button data-sym="${k}" title="${esc(v.label)}" class="${k === state.symbolType ? 'active' : ''}"><svg viewBox="-16 -12 32 24" width="40" height="30">${v.draw(0, 0, 0.9)}</svg></button>`).join('') + '</div>' +
        `<p class="muted small" id="symLabel">${esc(SYMBOLS[state.symbolType].label)}</p>`;
      box.querySelectorAll('[data-sym]').forEach(b => b.onclick = () => {
        state.symbolType = b.dataset.sym;
        renderToolOptions();
      });
    } else if (state.tool === 'line') {
      const l = activeLine();
      box.innerHTML = l ? `<p class="small">Drawing: <span class="chip" style="--c:${esc(l.color)}">${esc(l.name)}</span></p>` : '<p class="small muted">Add a line first.</p>';
    } else {
      box.innerHTML = '';
    }
  }

  /* --------------------------------------------------------------- line list */

  function renderLineList() {
    const ul = $('#lineList');
    const idx = D.buildIndex(state.doc);
    const counts = new Map();
    for (const [, set] of idx.stationLines) for (const lid of set) counts.set(lid, (counts.get(lid) || 0) + 1);
    ul.innerHTML = state.doc.lines.map((l, i) => `
      <li class="${l.id === state.activeLineId ? 'active' : ''}${l.hidden ? ' is-hidden' : ''}" data-line="${esc(l.id)}">
        <span class="swatch ${esc(l.style)}" style="--c:${esc(l.color)}"></span>
        <span class="name">${esc(l.name)}<small>${counts.get(l.id) || 0} stations</small></span>
        <button class="mini" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="mini" data-act="eye" title="${l.hidden ? 'Show' : 'Hide'}">${l.hidden ? '◌' : '●'}</button>
      </li>`).join('') || '<li class="empty muted">No lines yet — add a TfL line or create your own.</li>';
    ul.querySelectorAll('li[data-line]').forEach(li => {
      li.onclick = e => {
        const id = li.dataset.line;
        const act = e.target.dataset.act;
        const l = lineById(id);
        if (act === 'eye') { pushHistory(); l.hidden = !l.hidden; changed(); return; }
        if (act === 'up') {
          pushHistory();
          const i = state.doc.lines.indexOf(l);
          state.doc.lines.splice(i, 1);
          state.doc.lines.splice(i - 1, 0, l);
          changed();
          return;
        }
        if (state.drawing && state.drawing.lineId !== id) finishDrawing();
        state.activeLineId = id;
        select({ kind: 'line', id });
        renderToolOptions();
      };
    });
  }

  /* --------------------------------------------------------- properties UI */

  function field(label, html) { return `<label class="field"><span>${label}</span>${html}</label>`; }
  function checkbox(id, label, checked) { return `<label class="check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${label}</label>`; }

  function bind(id, ev, fn) { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }

  /** Apply a property change with one history step per focus session. */
  let editSession = null;
  function edit(fn, opts = {}) {
    const key = opts.session;
    if (!key || editSession !== key) { pushHistory(); editSession = key || null; }
    fn();
    changed(true, opts.panel !== false);
  }

  function renderProps() {
    const box = $('#props');
    const sel = state.selection;
    editSession = null;
    if (state.multi.size) return renderMultiProps(box);
    if (!sel) return renderDocProps(box);
    switch (sel.kind) {
      case 'station': return renderStationProps(box, stationById(sel.id));
      case 'line': return renderLineProps(box, lineById(sel.id));
      case 'edge': return renderEdgeProps(box, sel.id);
      case 'connector': return renderConnectorProps(box, state.doc.connectors.find(c => c.id === sel.id));
      case 'symbol': return renderSymbolProps(box, state.doc.symbols.find(s => s.id === sel.id));
      case 'text': return renderTextProps(box, state.doc.texts.find(t => t.id === sel.id));
      case 'zone': return renderZoneProps(box, state.doc.zones.find(z => z.id === sel.id));
      case 'river': return renderRiverProps(box);
      case 'key': return renderKeyProps(box);
      default: return renderDocProps(box);
    }
  }

  function renderMultiProps(box) {
    box.innerHTML = `<h3>${state.multi.size} stations selected</h3>
      <p class="muted small">Drag any of them to move the group, or use the arrow keys (Shift = grid step).</p>
      <button class="btn" id="mAlignH">Align horizontally</button>
      <button class="btn" id="mAlignV">Align vertically</button>
      <button class="btn danger" id="mDelete">Delete stations</button>`;
    const ids = [...state.multi];
    const align = axis => edit(() => {
      const sts = ids.map(stationById);
      const avg = snap(sts.reduce((a, s) => a + s[axis], 0) / sts.length);
      sts.forEach(s => { s[axis] = avg; });
    });
    bind('mAlignH', 'click', () => align('y'));
    bind('mAlignV', 'click', () => align('x'));
    bind('mDelete', 'click', deleteSelection);
  }

  function renderStationProps(box, st) {
    if (!st) return renderDocProps(box);
    const idx = D.buildIndex(state.doc);
    const lids = [...(idx.stationLines.get(st.id) || [])];
    const al = activeLine();
    const positions = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'];
    box.innerHTML = `
      <h3>Station</h3>
      ${field('Name <small class="muted">(Enter = new label line)</small>', `<textarea id="propName" rows="2">${esc(st.label.lines.join('\n'))}</textarea>`)}
      <div class="field"><span>Label position</span>
        <div class="pos-grid">${positions.map(p => p ? `<button data-pos="${p}" class="${st.labelPos === p ? 'active' : ''}">${p}</button>` : '<span class="dot">●</span>').join('')}</div>
        <small class="muted">or drag the label on the map</small>
      </div>
      ${field('Label size', `<select id="propLabelScale"><option value="0.85">Small</option><option value="1">Normal</option><option value="1.2">Large</option><option value="1.5">Extra large</option></select>`)}
      <div class="row2">
        ${field('X', `<input id="propX" type="number" step="1" value="${st.x}">`)}
        ${field('Y', `<input id="propY" type="number" step="1" value="${st.y}">`)}
      </div>
      <h4>Key symbols</h4>
      ${field('Interchange circle', `<select id="propInter"><option value="auto">Automatic</option><option value="yes">Always</option><option value="no">Never (use tick)</option></select>`)}
      ${field('Step-free access', `<select id="propStep"><option value="none">None</option><option value="platform">Street to platform</option><option value="train">Street to train</option></select>`)}
      ${field('River services', `<select id="propRiver"><option value="none">None</option><option value="near">Less than 10 min walk</option><option value="far">More than 10 min walk</option></select>`)}
      ${checkbox('propNR', 'National Rail interchange', st.nationalRail)}
      ${checkbox('propAir', 'Airport', st.airport)}
      ${checkbox('propCoach', 'Coach station', st.coach)}
      ${checkbox('propClosed', 'Station closed', st.closed)}
      <h4>Lines at this station</h4>
      <div class="chips">${lids.map(id => { const l = lineById(id); return `<span class="chip" style="--c:${esc(l.color)}">${esc(l.name)} <button data-rm-line="${esc(id)}" title="Remove from ${esc(l.name)}">×</button></span>`; }).join('') || '<span class="muted small">Not on any line yet</span>'}</div>
      ${al && !lids.includes(al.id) ? `<button class="btn small" id="propAddToLine">Add to ${esc(al.name)}</button>` : ''}
      <h4>Connections</h4>
      <button class="btn small" id="propConnect">Add interchange connector…</button>
      <hr>
      <button class="btn danger" id="propDelete">Delete station</button>`;
    $('#propLabelScale').value = String(st.labelScale || 1);
    $('#propInter').value = st.interchange || 'auto';
    $('#propStep').value = st.stepFree || 'none';
    $('#propRiver').value = st.river || 'none';

    bind('propName', 'input', e => edit(() => {
      const lines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
      st.label.lines = lines.length ? lines : ['Station'];
      st.name = st.label.lines.join(' ');
      if (st.labelPos && st.labelPos !== 'custom') setLabelPos(st, st.labelPos);
    }, { session: 'name-' + st.id, panel: false }));
    box.querySelectorAll('[data-pos]').forEach(b => b.onclick = () => edit(() => setLabelPos(st, b.dataset.pos)));
    bind('propLabelScale', 'change', e => edit(() => { st.labelScale = +e.target.value; if (st.labelPos && st.labelPos !== 'custom') setLabelPos(st, st.labelPos); }));
    bind('propX', 'change', e => edit(() => { st.x = +e.target.value; }));
    bind('propY', 'change', e => edit(() => { st.y = +e.target.value; }));
    bind('propInter', 'change', e => edit(() => { st.interchange = e.target.value; }));
    bind('propStep', 'change', e => edit(() => { st.stepFree = e.target.value; }));
    bind('propRiver', 'change', e => edit(() => { st.river = e.target.value; }));
    bind('propNR', 'change', e => edit(() => { st.nationalRail = e.target.checked; }));
    bind('propAir', 'change', e => edit(() => { st.airport = e.target.checked; }));
    bind('propCoach', 'change', e => edit(() => { st.coach = e.target.checked; }));
    bind('propClosed', 'change', e => edit(() => { st.closed = e.target.checked; }));
    box.querySelectorAll('[data-rm-line]').forEach(b => b.onclick = () => edit(() => {
      const l = lineById(b.dataset.rmLine);
      l.branches = l.branches.map(br => br.filter(s => s !== st.id)).filter(br => br.length > 1);
    }));
    bind('propAddToLine', 'click', () => edit(() => {
      const l = activeLine();
      if (!l.branches.length) l.branches.push([st.id]);
      else l.branches[l.branches.length - 1].push(st.id);
    }));
    bind('propConnect', 'click', () => { setTool('connector'); state.connectorStart = st.id; status('Click the station to connect to'); });
    bind('propDelete', 'click', deleteSelection);
  }

  const STYLE_OPTS = [['solid', 'Solid (Tube)'], ['double', 'Double / cased'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['striped', 'Striped (weekend only)']];

  function renderLineProps(box, l) {
    if (!l) return renderDocProps(box);
    const stations = new Set(l.branches.flat()).size;
    box.innerHTML = `
      <h3>Line</h3>
      ${field('Name', `<input id="lnName" type="text" maxlength="60" value="${esc(l.name)}">`)}
      <div class="row2">
        ${field('Colour', `<input id="lnColor" type="color" value="${esc(l.color)}">`)}
        ${field('Hex', `<input id="lnHex" type="text" maxlength="7" value="${esc(l.color)}">`)}
      </div>
      ${field('Style', `<select id="lnStyle">${STYLE_OPTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`)}
      ${field('Group in key', `<input id="lnGroup" type="text" maxlength="60" value="${esc(l.group || '')}" placeholder="e.g. London Overground">`)}
      <p class="muted small">${stations} stations · ${l.branches.length} branch${l.branches.length === 1 ? '' : 'es'}</p>
      <button class="btn" id="lnDraw">Draw this line</button>
      <button class="btn" id="lnDup">Duplicate</button>
      <button class="btn" id="lnShare">Share as preset</button>
      <hr>
      <button class="btn danger" id="lnDelete">Delete line</button>`;
    $('#lnStyle').value = l.style;
    bind('lnName', 'input', e => edit(() => { l.name = e.target.value || 'Line'; }, { session: 'ln-name-' + l.id, panel: false }));
    bind('lnName', 'change', () => renderLineList());
    bind('lnColor', 'input', e => edit(() => { l.color = e.target.value.toUpperCase(); $('#lnHex').value = l.color; }, { session: 'ln-color-' + l.id, panel: false }));
    bind('lnColor', 'change', () => renderLineList());
    bind('lnHex', 'change', e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) edit(() => { l.color = e.target.value.toUpperCase(); }); });
    bind('lnStyle', 'change', e => edit(() => { l.style = e.target.value; }));
    bind('lnGroup', 'change', e => edit(() => { l.group = e.target.value.trim(); }));
    bind('lnDraw', 'click', () => { state.activeLineId = l.id; setTool('line'); });
    bind('lnDup', 'click', () => edit(() => {
      const c = JSON.parse(JSON.stringify(l));
      c.id = D.uid('line'); c.name = l.name + ' copy'; c.branches = [];
      state.doc.lines.push(c);
      state.selection = { kind: 'line', id: c.id };
      state.activeLineId = c.id;
    }));
    bind('lnShare', 'click', async () => {
      try { await API.savePreset({ name: l.name, color: l.color.toUpperCase(), style: l.style }); toast('Shared with the community presets'); } catch (e) { toast(e.message, 4000); }
    });
    bind('lnDelete', 'click', () => { if (confirm(`Delete the ${l.name} line? Stations stay on the map.`)) deleteSelection(); });
  }

  function renderEdgeProps(box, key) {
    const [a, b] = key.split('|');
    const A = stationById(a), B = stationById(b);
    const idx = D.buildIndex(state.doc);
    const lids = idx.edgeLines.get(key) || [];
    const e = state.doc.edges[key] || {};
    const shape = e.shape || 'auto';
    box.innerHTML = `
      <h3>Track segment</h3>
      <p><b>${esc(A ? A.name : a)}</b> ↔ <b>${esc(B ? B.name : b)}</b></p>
      <div class="chips">${lids.map(id => { const l = lineById(id); return `<span class="chip" style="--c:${esc(l.color)}">${esc(l.name)}</span>`; }).join('')}</div>
      <h4>Shape</h4>
      <div class="seg-buttons">
        <button data-shape="auto" class="${shape === 'auto' ? 'active' : ''}">${e.via && e.via.length ? 'Bend points' : 'Auto 45°'}</button>
        <button data-shape="straight" class="${shape === 'straight' ? 'active' : ''}">Straight</button>
        <button data-shape="elbow1" class="${shape === 'elbow1' ? 'active' : ''}">Elbow ⌐</button>
        <button data-shape="elbow2" class="${shape === 'elbow2' ? 'active' : ''}">Elbow ⟋</button>
      </div>
      ${e.via && e.via.length ? `<p class="muted small">${e.via.length} bend points — drag the blue handles to adjust.</p>
        <button class="btn small" id="edStraight">Remove bends</button>` : `<button class="btn small" id="edAddBend">Add a bend point</button>`}
      <hr>
      <button class="btn" id="edSplit">Insert station in the middle</button>
      <button class="btn danger" id="edDelete">Delete segment</button>`;
    box.querySelectorAll('[data-shape]').forEach(btn => btn.onclick = () => edit(() => {
      const cur = state.doc.edges[key] || {};
      // "Auto 45°" means: no bend points, pick the elbow automatically
      state.doc.edges[key] = btn.dataset.shape === 'auto' && !(cur.via && cur.via.length) ? { shape: 'auto' } : Object.assign(cur, { shape: btn.dataset.shape });
    }));
    bind('edStraight', 'click', () => edit(() => { state.doc.edges[key].via = []; state.doc.edges[key].shape = 'auto'; }));
    bind('edAddBend', 'click', () => edit(() => {
      const [P, Q] = a < b ? [A, B] : [B, A];
      state.doc.edges[key] = { shape: 'auto', via: [[(P.x + Q.x) / 2, (P.y + Q.y) / 2]] };
    }));
    bind('edSplit', 'click', () => edit(() => { const st = splitEdge(key); state.selection = { kind: 'station', id: st.id }; }));
    bind('edDelete', 'click', deleteSelection);
  }

  function renderConnectorProps(box, c) {
    if (!c) return renderDocProps(box);
    box.innerHTML = `
      <h3>Interchange connector</h3>
      <p><b>${esc((stationById(c.a) || {}).name)}</b> ↔ <b>${esc((stationById(c.b) || {}).name)}</b></p>
      ${field('Type', `<select id="cnType"><option value="walk">Walking link (dotted)</option><option value="internal">Internal interchange (blob)</option></select>`)}
      <hr><button class="btn danger" id="cnDelete">Delete connector</button>`;
    $('#cnType').value = c.type;
    bind('cnType', 'change', e => edit(() => { c.type = e.target.value; }));
    bind('cnDelete', 'click', deleteSelection);
  }

  function renderSymbolProps(box, s) {
    if (!s) return renderDocProps(box);
    box.innerHTML = `
      <h3>Key symbol</h3>
      ${field('Symbol', `<select id="syType">${Object.entries(SYMBOLS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>`)}
      ${field('Size', `<input id="syScale" type="range" min="0.5" max="4" step="0.1" value="${s.scale || 1}">`)}
      <hr><button class="btn danger" id="syDelete">Delete symbol</button>`;
    $('#syType').value = s.type;
    bind('syType', 'change', e => edit(() => { s.type = e.target.value; }));
    bind('syScale', 'input', e => edit(() => { s.scale = +e.target.value; }, { session: 'sy-' + s.id, panel: false }));
    bind('syDelete', 'click', deleteSelection);
  }

  function renderTextProps(box, t) {
    if (!t) return renderDocProps(box);
    box.innerHTML = `
      <h3>Text</h3>
      ${field('Text', `<textarea id="txText" rows="3">${esc(t.text)}</textarea>`)}
      <div class="row2">
        ${field('Size', `<input id="txSize" type="number" min="6" max="200" value="${t.size || 16}">`)}
        ${field('Colour', `<input id="txColor" type="color" value="${esc(t.color || '#1c2c6b')}">`)}
      </div>
      ${field('Align', `<select id="txAnchor"><option value="start">Left</option><option value="middle">Centre</option><option value="end">Right</option></select>`)}
      ${checkbox('txBold', 'Bold', t.bold)}
      <hr><button class="btn danger" id="txDelete">Delete text</button>`;
    $('#txAnchor').value = t.anchor || 'start';
    bind('txText', 'input', e => edit(() => { t.text = e.target.value; }, { session: 'tx-' + t.id, panel: false }));
    bind('txSize', 'change', e => edit(() => { t.size = +e.target.value; }));
    bind('txColor', 'input', e => edit(() => { t.color = e.target.value; }, { session: 'txc-' + t.id, panel: false }));
    bind('txAnchor', 'change', e => edit(() => { t.anchor = e.target.value; }));
    bind('txBold', 'change', e => edit(() => { t.bold = e.target.checked; }));
    bind('txDelete', 'click', deleteSelection);
  }

  function renderZoneProps(box, z) {
    if (!z) return renderDocProps(box);
    box.innerHTML = `
      <h3>Fare zone</h3>
      ${field('Label', `<input id="znLabel" type="text" maxlength="10" value="${esc(z.label)}">`)}
      ${field('Fill', `<input id="znFill" type="color" value="${esc(z.fill || '#eeeeee')}">`)}
      <p class="muted small">Drag the blue corner handles to reshape. Erase tool on a handle removes a corner.</p>
      <button class="btn small" id="znAddPt">Add corner</button>
      <button class="btn small" id="znUp">Bring forward</button>
      <button class="btn small" id="znDown">Send backward</button>
      <hr><button class="btn danger" id="znDelete">Delete zone</button>`;
    bind('znLabel', 'input', e => edit(() => { z.label = e.target.value; }, { session: 'zn-' + z.id, panel: false }));
    bind('znFill', 'input', e => edit(() => { z.fill = e.target.value; }, { session: 'znf-' + z.id, panel: false }));
    bind('znAddPt', 'click', () => edit(() => {
      // split the longest side
      let best = 0, bi = 0;
      z.points.forEach((p, i) => { const q = z.points[(i + 1) % z.points.length]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; bi = i; } });
      const p = z.points[bi], q = z.points[(bi + 1) % z.points.length];
      z.points.splice(bi + 1, 0, [Math.round((p[0] + q[0]) / 2), Math.round((p[1] + q[1]) / 2)]);
    }));
    const move = dir => edit(() => {
      const zs = state.doc.zones, i = zs.indexOf(z), j = i + dir;
      if (j < 0 || j >= zs.length) return;
      zs.splice(i, 1); zs.splice(j, 0, z);
    });
    bind('znUp', 'click', () => move(1));
    bind('znDown', 'click', () => move(-1));
    bind('znDelete', 'click', deleteSelection);
  }

  function renderRiverProps(box) {
    const r = state.doc.river;
    box.innerHTML = `
      <h3>River Thames</h3>
      ${field('Width', `<input id="rvWidth" type="range" min="6" max="60" value="${r.width || 22}">`)}
      <p class="muted small">${r.points.length} points — drag the handles to reshape. Erase tool on a handle removes a point.</p>
      <button class="btn small" id="rvAdd">Add point at end</button>
      <hr><button class="btn danger" id="rvDelete">Remove river</button>`;
    bind('rvWidth', 'input', e => edit(() => { r.width = +e.target.value; }, { session: 'rv', panel: false }));
    bind('rvAdd', 'click', () => edit(() => {
      const last = r.points[r.points.length - 1] || [state.doc.width / 2, state.doc.height / 2];
      r.points.push([last[0] + 80, last[1]]);
    }));
    bind('rvDelete', 'click', deleteSelection);
  }

  function renderKeyProps(box) {
    const k = state.doc.key;
    box.innerHTML = `
      <h3>Key / legend</h3>
      ${field('Title', `<input id="kyTitle" type="text" maxlength="60" value="${esc(k.title || 'Key to lines')}">`)}
      ${field('Columns', `<select id="kyCols"><option>1</option><option>2</option><option>3</option><option>4</option></select>`)}
      <p class="muted small">The key lists every visible line and each symbol used on the map. Drag it to move it.</p>
      <hr><button class="btn" id="kyHide">Hide key</button>`;
    $('#kyCols').value = String(k.columns || 3);
    bind('kyCols', 'change', e => edit(() => { k.columns = +e.target.value; }));
    bind('kyTitle', 'input', e => edit(() => { k.title = e.target.value; }, { session: 'ky', panel: false }));
    bind('kyHide', 'click', () => edit(() => { k.visible = false; state.selection = null; }));
  }

  function renderDocProps(box) {
    const d = state.doc, S = d.settings;
    const nStations = d.stations.length;
    box.innerHTML = `
      <h3>Map settings</h3>
      <p class="muted small">${nStations} stations · ${d.lines.length} lines · ${d.connectors.length} connectors</p>
      ${field('Title', `<input id="dsTitle" type="text" maxlength="120" value="${esc(d.title)}">`)}
      <div class="row2">
        ${field('Width', `<input id="dsW" type="number" min="400" max="10000" step="10" value="${d.width}">`)}
        ${field('Height', `<input id="dsH" type="number" min="300" max="10000" step="10" value="${d.height}">`)}
      </div>
      ${field('Line thickness', `<input id="dsLW" type="range" min="3" max="16" step="0.5" value="${S.lineWidth}">`)}
      ${field('Label size', `<input id="dsLS" type="range" min="7" max="22" step="0.5" value="${S.labelSize}">`)}
      <div class="row2">
        ${field('Label colour', `<input id="dsLC" type="color" value="${esc(S.labelColor)}">`)}
        ${field('Background', `<input id="dsBG" type="color" value="${esc(S.background)}">`)}
      </div>
      ${field('Font', `<select id="dsFont">
        <option value="Arial, Helvetica, sans-serif">Arial / Helvetica</option>
        <option value="'Gill Sans', 'Gill Sans MT', Calibri, sans-serif">Gill Sans (Johnston-like)</option>
        <option value="Verdana, Geneva, sans-serif">Verdana</option>
        <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
        <option value="Georgia, serif">Georgia</option></select>`)}
      <h4>Show</h4>
      ${checkbox('dsZones', 'Fare zones', S.showZones)}
      ${checkbox('dsRiver', 'River Thames', S.showRiver)}
      ${checkbox('dsKey', 'Key / legend', S.showKey && d.key.visible)}
      ${checkbox('dsLabels', 'Station names', S.showLabels)}
      ${checkbox('dsIcons', 'Station symbols (step-free, rail…)', S.showIcons)}
      ${checkbox('dsGrid', 'Grid (editor only)', S.showGrid)}
      ${checkbox('dsSnap', 'Snap to grid', S.snap)}
      ${checkbox('dsOcti', 'Keep tracks at 0° / 45° / 90°', S.octilinear !== false)}
      <button class="btn small" id="dsStraighten">Straighten whole map to 45°</button>
      ${field('Grid size', `<input id="dsGridSize" type="number" min="2" max="100" value="${S.grid}">`)}
      <button class="btn small" id="dsFit">Fit canvas to map</button>
      <h4>Fare zones</h4>
      <button class="btn small" id="dsZoneAdd">Add zone</button>
      <button class="btn small" id="dsZoneReset">Rebuild zones 1–6</button>
      <button class="btn small" id="dsRiverSel">Edit river</button>`;
    $('#dsFont').value = S.font;
    bind('dsTitle', 'input', e => edit(() => { d.title = e.target.value; $('#docTitle').value = d.title; }, { session: 'title', panel: false }));
    bind('dsW', 'change', e => edit(() => { d.width = Math.max(400, +e.target.value); }));
    bind('dsH', 'change', e => edit(() => { d.height = Math.max(300, +e.target.value); }));
    bind('dsLW', 'input', e => edit(() => { S.lineWidth = +e.target.value; }, { session: 'lw', panel: false }));
    bind('dsLS', 'input', e => edit(() => { S.labelSize = +e.target.value; }, { session: 'ls', panel: false }));
    bind('dsLC', 'input', e => edit(() => { S.labelColor = e.target.value; }, { session: 'lc', panel: false }));
    bind('dsBG', 'input', e => edit(() => { S.background = e.target.value; }, { session: 'bg', panel: false }));
    bind('dsFont', 'change', e => edit(() => { S.font = e.target.value; }));
    bind('dsZones', 'change', e => edit(() => { S.showZones = e.target.checked; }));
    bind('dsRiver', 'change', e => edit(() => { S.showRiver = e.target.checked; }));
    bind('dsKey', 'change', e => edit(() => { S.showKey = e.target.checked; d.key.visible = e.target.checked; }));
    bind('dsLabels', 'change', e => edit(() => { S.showLabels = e.target.checked; }));
    bind('dsIcons', 'change', e => edit(() => { S.showIcons = e.target.checked; }));
    bind('dsGrid', 'change', e => edit(() => { S.showGrid = e.target.checked; }));
    bind('dsSnap', 'change', e => edit(() => { S.snap = e.target.checked; }));
    bind('dsOcti', 'change', e => edit(() => { S.octilinear = e.target.checked; }));
    bind('dsStraighten', 'click', () => {
      edit(() => { S.octilinear = true; D.octilinearize(d); });
      toast('Map straightened: every track now runs at 0°, 45° or 90°');
    });
    bind('dsGridSize', 'change', e => edit(() => { S.grid = Math.max(2, +e.target.value); updateGridDefs(); }));
    bind('dsFit', 'click', () => { edit(() => { D.fitToContent(d, 40); }); fitView(); });
    bind('dsZoneAdd', 'click', () => edit(() => {
      const n = d.zones.length + 1;
      const cx = d.width / 2, cy = d.height / 2, w = 150, h = 100;
      const z = { id: D.uid('zone'), label: String(n), fill: '#e8eef8', points: [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h]] };
      d.zones.push(z);
      state.selection = { kind: 'zone', id: z.id };
    }));
    bind('dsZoneReset', 'click', () => edit(() => {
      const st = d.stations;
      const cx = st.length ? st.reduce((a, s) => a + s.x, 0) / st.length : d.width / 2;
      const cy = st.length ? st.reduce((a, s) => a + s.y, 0) / st.length : d.height / 2;
      d.zones = D.makeZones(cx, cy);
      S.showZones = true;
    }));
    bind('dsRiverSel', 'click', () => {
      if (!d.river.points.length) edit(() => { d.river.points = [[d.width * 0.1, d.height * 0.6], [d.width * 0.5, d.height * 0.55], [d.width * 0.9, d.height * 0.62]]; });
      select({ kind: 'river', id: 'river' });
    });
  }

  /* ------------------------------------------------------- add line dialog */

  function openLineDialog() {
    const dlg = $('#dlgLine');
    const used = new Set(state.doc.lines.map(l => l.id));
    $('#presetGrid').innerHTML = D.TFL_PRESETS.map(p => `
      <button type="button" class="preset" data-preset="${p.id}" ${used.has(p.id) ? 'disabled title="Already on the map"' : ''}>
        <span class="swatch ${p.style}" style="--c:${p.color}"></span>${esc(p.name)}${p.group ? `<small>${esc(p.group)}</small>` : ''}</button>`).join('');
    $('#presetGrid').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      const p = D.TFL_PRESETS.find(x => x.id === b.dataset.preset);
      addLine({ id: p.id, name: p.name, color: p.color, style: p.style, group: p.group || '' });
      dlg.close();
    });
    switchTab('tfl');
    dlg.showModal();
    loadCommunityPresets();
  }

  function switchTab(name) {
    $$('#dlgLine .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('#dlgLine .tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  }

  async function loadCommunityPresets() {
    const box = $('#communityPresets');
    try {
      const { presets } = await API.presets();
      box.innerHTML = presets.length ? presets.map((p, i) => `
        <button type="button" class="preset" data-cp="${i}"><span class="swatch ${esc(p.style)}" style="--c:${esc(p.color)}"></span>${esc(p.name)}<small>used ${p.uses}×</small></button>`).join('')
        : '<p class="muted">No community presets yet — create a custom line and share it!</p>';
      box.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => {
        const p = presets[+b.dataset.cp];
        addLine({ name: p.name, color: p.color, style: p.style });
        $('#dlgLine').close();
      });
    } catch (e) {
      box.innerHTML = `<p class="muted">Community presets need the PHP/MySQL backend (${esc(e.message)}).</p>`;
    }
  }

  function addLine(spec) {
    pushHistory();
    let id = spec.id || slugify(spec.name);
    const ids = new Set(state.doc.lines.map(l => l.id));
    let i = 2;
    const base = id;
    while (ids.has(id)) id = `${base}-${i++}`;
    const line = { id, name: spec.name, color: spec.color.toUpperCase(), style: spec.style || 'solid', group: spec.group || '', branches: [], hidden: false };
    state.doc.lines.push(line);
    state.activeLineId = id;
    state.selection = { kind: 'line', id };
    setTool('line');
    toast(`${line.name} added — click stations to draw it`);
    changed();
  }

  function updateCustomPreview() {
    const c = $('#newLineColor').value, s = $('#newLineStyle').value;
    $('#newLinePreview').innerHTML = `<svg viewBox="0 0 200 24" width="200" height="24">${
      { solid: `<path d="M10,12 H190" stroke="${c}" stroke-width="8"/>`,
        double: `<path d="M10,12 H190" stroke="${c}" stroke-width="8"/><path d="M10,12 H190" stroke="#fff" stroke-width="3"/>`,
        dashed: `<path d="M10,12 H190" stroke="${c}" stroke-width="8" stroke-dasharray="14 7"/>`,
        dotted: `<path d="M10,12 H190" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-dasharray="0.1 13"/>`,
        striped: `<path d="M10,12 H190" stroke="${c}" stroke-width="8"/><path d="M10,12 H190" stroke="#fff" stroke-width="4" stroke-dasharray="9 9"/>` }[s]
    }</svg> <b>${esc($('#newLineName').value)}</b>`;
  }

  /* --------------------------------------------------------------- publish */

  async function openPublish() {
    const d = state.doc;
    if (!d.stations.length) { toast('Add some stations before uploading'); return; }
    const dlg = $('#dlgPublish');
    $('#pubTitle').value = d.title || '';
    try { $('#pubAuthor').value = localStorage.getItem('tubemaker.author') || ''; } catch (e) { /* ignore */ }
    $('#pubDesc').value = (d.community && d.community.description) || '';
    $('#pubError').textContent = '';
    const myId = d.community && d.community.id;
    const canUpdate = myId && API.tokens()[myId];
    $('#pubUpdateRow').hidden = !canUpdate;
    $('#publishPreview').removeAttribute('src');
    dlg.showModal();
    try { $('#publishPreview').src = await X.thumbnail(d, 900); } catch (e) { /* preview optional */ }
  }

  async function submitPublish() {
    const d = state.doc;
    const btn = $('#pubSubmit');
    const title = $('#pubTitle').value.trim();
    if (!title) { $('#pubError').textContent = 'Please enter a title.'; return; }
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    $('#pubError').textContent = '';
    try {
      const author = $('#pubAuthor').value.trim();
      try { localStorage.setItem('tubemaker.author', author); } catch (e) { /* ignore */ }
      const data = JSON.parse(JSON.stringify(d));
      delete data.community;
      data.title = title;
      const thumbnail = await X.thumbnail(data, 1400);
      const myId = d.community && d.community.id;
      const token = myId && API.tokens()[myId];
      let id;
      if (token && $('#pubUpdate').checked) {
        await API.update({ id: myId, token, title, author, description: $('#pubDesc').value, data, thumbnail });
        id = myId;
      } else {
        const res = await API.create({ title, author, description: $('#pubDesc').value, data, thumbnail, remix_of: (d.community && d.community.remixOf) || null });
        API.saveToken(res.id, res.token);
        id = res.id;
      }
      d.community = Object.assign({}, d.community, { id, description: $('#pubDesc').value });
      d.title = title;
      $('#docTitle').value = title;
      autosave();
      $('#dlgPublish').close();
      toast('Uploaded! Opening the community page…');
      setTimeout(() => { location.href = 'community.html#map=' + encodeURIComponent(id); }, 900);
    } catch (e) {
      $('#pubError').textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload';
    }
  }

  /* ----------------------------------------------------------------- setup */

  function onAction(action, el) {
    switch (action) {
      case 'new-template':
        if (state.doc.stations.length && !confirm('Replace the current map with the TfL template?')) return;
        pushHistory();
        loadDoc(D.templateDoc(), false);
        toast('TfL template loaded');
        break;
      case 'new-blank':
        if (state.doc.stations.length && !confirm('Start a new blank map? (You can undo this.)')) return;
        pushHistory();
        loadDoc(D.blankDoc(), false);
        break;
      case 'open-json': $('#fileInput').click(); break;
      case 'save-json': X.exportJSON(state.doc); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'png':
        status('Rendering PNG…');
        X.exportPNG(state.doc, +el.dataset.scale).then(() => status('PNG exported')).catch(e => toast(e.message, 4000));
        break;
      case 'pdf':
        status('Rendering PDF…');
        X.exportPDF(state.doc, el.dataset.paper).then(() => status('PDF exported')).catch(e => toast(e.message, 5000));
        break;
      case 'svg': X.exportSVG(state.doc); break;
      case 'publish': openPublish(); break;
      case 'help': $('#dlgHelp').showModal(); break;
      case 'add-line': openLineDialog(); break;
      case 'zoom-in': zoomButton(1.25); break;
      case 'zoom-out': zoomButton(0.8); break;
      case 'zoom-fit': fitView(); break;
    }
  }

  function setupUI() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (b) { onAction(b.dataset.action, b); b.closest('.menu') && b.closest('.menu').classList.remove('open'); }
      const m = e.target.closest('.menu > .btn');
      $$('.menu').forEach(menu => { if (!m || menu !== m.parentElement) menu.classList.remove('open'); });
      if (m) m.parentElement.classList.toggle('open');
    });
    $$('#tools button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    $('#docTitle').addEventListener('input', e => edit(() => { state.doc.title = e.target.value; }, { session: 'title', panel: false }));
    $('#docTitle').addEventListener('blur', () => { editSession = null; });

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('contextmenu', e => { e.preventDefault(); if (state.drawing) finishDrawing(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', e => { if (e.key === ' ') { state.spaceDown = false; wrap.classList.remove('pan-ready'); } });
    window.addEventListener('resize', () => applyView());

    $('#fileInput').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const doc = JSON.parse(await f.text());
        if (!doc.stations || !doc.lines) throw new Error('Not a TubeMaker map file');
        pushHistory();
        loadDoc(doc, false);
        toast('Map opened');
      } catch (err) { toast('Could not open file: ' + err.message, 4000); }
    });

    $$('#dlgLine .tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
    ['newLineColor', 'newLineStyle', 'newLineName'].forEach(id => $('#' + id).addEventListener('input', updateCustomPreview));
    updateCustomPreview();
    $('#createCustomLine').onclick = () => {
      const spec = { name: $('#newLineName').value.trim() || 'New line', color: $('#newLineColor').value, style: $('#newLineStyle').value, group: $('#newLineGroup').value.trim() };
      addLine(spec);
      if ($('#newLineShare').checked) API.savePreset({ name: spec.name, color: spec.color.toUpperCase(), style: spec.style }).catch(() => {});
      $('#dlgLine').close();
    };
    $('#pubSubmit').onclick = submitPublish;
  }

  async function init() {
    setupUI();
    const params = new URLSearchParams(location.search);
    const remix = params.get('remix') || params.get('map');
    let doc = null;
    if (remix) {
      try {
        const { map } = await API.get(remix);
        doc = map.data;
        doc.community = { remixOf: map.id };
        if (API.tokens()[map.id]) doc.community.id = map.id; // it's our own map: allow updating
        toast(`Loaded “${map.title}” by ${map.author}`);
      } catch (e) { toast('Could not load community map: ' + e.message, 5000); }
    }
    if (!doc) {
      try { const saved = localStorage.getItem(AUTOSAVE_KEY); if (saved) doc = JSON.parse(saved); } catch (e) { doc = null; }
      // Maps saved before 45-degree mode existed get straightened once.
      if (doc && doc.settings && doc.settings.octilinear === undefined && doc.stations && doc.stations.length) {
        doc = D.octilinearize(D.normalize(doc));
        toast('Your saved map was straightened to 0°/45°/90° tracks (use New ▸ TfL template to start fresh)', 5000);
      }
    }
    if (!doc) doc = D.templateDoc();
    state.doc = D.normalize(doc);
    state.activeLineId = state.doc.lines[0] ? state.doc.lines[0].id : null;
    afterDocReplaced(true);
    setTool('select');
    if (remix) history.replaceState(null, '', location.pathname);
    try {
      if (!localStorage.getItem('tubemaker.seenHelp')) { $('#dlgHelp').showModal(); localStorage.setItem('tubemaker.seenHelp', '1'); }
    } catch (e) { /* ignore */ }
  }

  // exposed for debugging / tests
  window.TubeEditor = { state, render, loadDoc, setTool, fitView };
  init();
})();
