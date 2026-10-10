/* Map document model + helpers shared by the editor, renderer and community viewer. */
(function () {
  const VERSION = 1;

  // TfL palette offered when adding a line (Thameslink, Cable Car and Trams intentionally left out).
  const TFL_PRESETS = [
    { id: 'bakerloo', name: 'Bakerloo', color: '#B36305', style: 'solid' },
    { id: 'central', name: 'Central', color: '#E32017', style: 'solid' },
    { id: 'circle', name: 'Circle', color: '#FFD300', style: 'solid' },
    { id: 'district', name: 'District', color: '#00782A', style: 'solid' },
    { id: 'hammersmith-city', name: 'Hammersmith & City', color: '#F3A9BB', style: 'solid' },
    { id: 'jubilee', name: 'Jubilee', color: '#A0A5A9', style: 'solid' },
    { id: 'metropolitan', name: 'Metropolitan', color: '#9B0056', style: 'solid' },
    { id: 'northern', name: 'Northern', color: '#000000', style: 'solid' },
    { id: 'piccadilly', name: 'Piccadilly', color: '#003688', style: 'solid' },
    { id: 'victoria', name: 'Victoria', color: '#0098D4', style: 'solid' },
    { id: 'waterloo-city', name: 'Waterloo & City', color: '#95CDBA', style: 'solid' },
    { id: 'dlr', name: 'DLR', color: '#00A4A7', style: 'double' },
    { id: 'elizabeth', name: 'Elizabeth line', color: '#6950A1', style: 'double' },
    { id: 'liberty', name: 'Liberty line', color: '#5D6061', style: 'double', group: 'London Overground' },
    { id: 'lioness', name: 'Lioness line', color: '#FAA61A', style: 'double', group: 'London Overground' },
    { id: 'mildmay', name: 'Mildmay line', color: '#0077AD', style: 'double', group: 'London Overground' },
    { id: 'suffragette', name: 'Suffragette line', color: '#5BBD72', style: 'double', group: 'London Overground' },
    { id: 'weaver', name: 'Weaver line', color: '#823A62', style: 'double', group: 'London Overground' },
    { id: 'windrush', name: 'Windrush line', color: '#ED1B00', style: 'double', group: 'London Overground' },
  ];

  // Walking / internal connectors drawn on the reference map.
  const TEMPLATE_CONNECTORS = [
    ['bank', 'monument', 'internal'],
    ['tower-hill', 'tower-gateway', 'walk'],
    ['hanger-lane', 'park-royal', 'walk'],
    ['kenton', 'northwick-park', 'walk'],
    ['euston', 'euston-square', 'walk'],
    ['seven-sisters', 'south-tottenham', 'walk'],
    ['wood-lane', 'white-city', 'walk'],
    ['archway', 'upper-holloway', 'walk'],
    ['walthamstow-central', 'walthamstow-queen-s-road', 'walk'],
    ['wanstead-park', 'forest-gate', 'walk'],
    ['hackney-central', 'hackney-downs', 'walk'],
    ['woolwich-arsenal', 'woolwich', 'walk'],
    ['finchley-road', 'finchley-road-and-frognal', 'walk'],
    ['clapham-high-street', 'clapham-north', 'walk'],
    ['leytonstone', 'leytonstone-high-road', 'walk'],
    ['camden-town', 'camden-road', 'walk'],
  ];

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function edgeKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function defaultSettings() {
    return {
      lineWidth: 7, labelSize: 11, snap: true, grid: 10, octilinear: true,
      showGrid: false, showZones: true, showRiver: true, showKey: true, showLabels: true, showIcons: true,
      background: '#ffffff', labelColor: '#1c2c6b', font: 'Arial, Helvetica, sans-serif',
    };
  }

  function blankDoc() {
    return {
      version: VERSION,
      title: 'My Tube Map',
      width: 2450,
      height: 1725,
      settings: defaultSettings(),
      lines: [],
      stations: [],
      edges: {},
      connectors: [],
      zones: [],
      river: { points: [], width: 22 },
      symbols: [],
      texts: [],
      key: { x: 20, y: 1400, visible: true, title: 'Key to lines', columns: 3 },
    };
  }

  /** Concentric fare zones shaped like the chamfered bands on the TfL map. */
  function makeZones(cx, cy) {
    const sizes = [[300, 205], [470, 330], [640, 450], [830, 590], [1010, 720], [1190, 860]];
    const zones = [];
    for (let i = sizes.length - 1; i >= 0; i--) {
      const [w, h] = sizes[i];
      const c = Math.min(w, h) * 0.42; // chamfer
      zones.push({
        id: 'zone-' + (i + 1),
        label: String(i + 1),
        fill: i % 2 === 0 ? '#eeeeee' : '#ffffff',
        points: [
          [cx - w + c, cy - h], [cx + w - c, cy - h], [cx + w, cy - h + c], [cx + w, cy + h - c],
          [cx + w - c, cy + h], [cx - w + c, cy + h], [cx - w, cy + h - c], [cx - w, cy - h + c],
        ].map(p => p.map(v => Math.round(v))),
      });
    }
    return zones;
  }

  /** Build an editable document from the TfL-derived template data. */
  // Measurements of the TfL large print map, used by the template.
  const TFL_STYLE = {
    lineWidth: 5.7, cornerRadius: 9, labelSize: 12, labelLeading: 0.95,
    markerRadius: 8.6, markerRing: 2.9, markerColor: '#231f20', tickLength: 7, tickWidth: 4,
    stepFreeInline: false, inlineIcons: false, labelColor: '#263d96',
    font: "Johnston100, 'London Tube', Railway, 'Gill Sans', 'Gill Sans MT', Arial, sans-serif",
  };

  /** Build an editable document from the TfL-derived template data. */
  function templateDoc() {
    const t = window.TUBE_TEMPLATE;
    const doc = blankDoc();
    doc.title = 'London Underground (template)';
    doc.templateVersion = 3;
    doc.width = t.width;
    doc.height = t.height;
    Object.assign(doc.settings, TFL_STYLE);
    doc.stations = t.stations.map(s => ({
      id: s.id, name: s.name, x: s.x, y: s.y,
      label: { lines: s.label.lines.slice(), dx: s.label.dx, dy: s.label.dy, anchor: s.label.anchor },
      nationalRail: !!s.nationalRail, airport: !!s.airport, coach: !!s.coach,
      river: s.river === true ? 'near' : (s.river || 'none'),
      placedIcons: (s.icons || []).map(i => Object.assign({}, i)),
      stepFree: s.stepFree || 'none', closed: false,
      interchange: s.marker === 'interchange' ? 'yes' : s.marker === 'tick' ? 'no' : 'auto',
      // TfL draws the step-free icon in place of the station marker
      markerIcon: s.marker === 'train' || s.marker === 'platform',
      extra: (s.extra || []).map(e => ({ x: e.x, y: e.y, kind: e.kind })),
      links: (s.links || []).map(l => l.slice()),
      railIcon: s.rail ? { dx: s.rail[0], dy: s.rail[1] } : null,
      zone: s.tfl && s.tfl.zone ? s.tfl.zone : '',
      naptan: s.tfl ? s.tfl.naptan : '',
      labelBox: s.box ? { dx: s.box[0], dy: s.box[1], w: s.box[2], h: s.box[3] } : null,
      hideLabel: !!s.hideLabel,
    }));
    doc.lines = t.lines.map(l => ({
      id: l.id, name: l.name, color: l.color, style: l.style, group: l.group || '',
      branches: l.branches.map(b => b.slice()), hidden: false, z: l.z,
    }));
    for (const [key, e] of Object.entries(t.edges || {})) {
      doc.edges[key] = { lines: Object.fromEntries(Object.entries(e.lines).map(([lid, pts]) => [lid, pts.map(p => p.slice())])) };
    }
    const ids = new Set(doc.stations.map(s => s.id));
    doc.connectors = (t.walks || TEMPLATE_CONNECTORS).filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b, type, pa, pb]) => {
      // exact ends (which circle of a complex) as offsets from each station
      const A = doc.stations.find(s => s.id === a), B = doc.stations.find(s => s.id === b);
      const c = { id: uid('c'), a, b, type };
      if (pa && pb) { c.da = [pa[0] - A.x, pa[1] - A.y]; c.db = [pb[0] - B.x, pb[1] - B.y]; }
      return c;
    });
    // Fare-zone shading, river and zone numbers copied from the TfL artwork.
    doc.zones = (t.zones || []).map((z, i) => ({
      id: 'zone-' + (i + 1), label: '', fill: z.fill, stroke: z.stroke, strokeWidth: z.strokeWidth,
      points: [], rings: z.rings.map(r => r.map(p => p.slice())),
    }));
    doc.river = { points: [], polygons: (t.river || []).map(pl => pl.map(p => p.slice())), width: 22 };
    doc.texts = (t.zoneNumbers || []).map((n, i) => ({
      id: 'zn-' + i, x: n.x, y: n.y, text: n.text, size: n.size, color: '#e9e9e9', bold: false, anchor: 'start', back: true,
    }));
    doc.key = { x: 12, y: doc.height - 330, visible: true, title: 'Key to lines', columns: 3 };
    return doc;
  }

  /** Make sure a loaded document has every field the editor expects. */
  function normalize(doc) {
    const base = blankDoc();
    const out = Object.assign(base, doc || {});
    out.settings = Object.assign(defaultSettings(), (doc && doc.settings) || {});
    out.lines = (out.lines || []).map(l => Object.assign({ group: '', hidden: false, style: 'solid', branches: [] }, l));
    out.stations = (out.stations || []).map(s => Object.assign({
      name: 'Station', label: { lines: [s.name || 'Station'], dx: 10, dy: 4, anchor: 'start' },
      nationalRail: false, airport: false, river: 'none', coach: false, stepFree: 'none', interchange: 'auto', closed: false,
      extra: [], markerIcon: false, hideLabel: false,
    }, s));
    out.edges = out.edges || {};
    out.connectors = out.connectors || [];
    out.zones = out.zones || [];
    out.river = Object.assign({ points: [], polygons: [], width: 22 }, out.river || {});
    out.symbols = out.symbols || [];
    out.texts = out.texts || [];
    out.key = Object.assign({ x: 20, y: out.height - 420, visible: true, title: 'Key to lines' }, out.key || {});
    out.version = VERSION;
    return out;
  }

  /** Index helpers rebuilt whenever the document changes. */
  function buildIndex(doc) {
    const stations = new Map(doc.stations.map(s => [s.id, s]));
    const stationLines = new Map();     // station id -> Set(line id)
    const edgeLines = new Map();        // edge key -> [line ids] in drawing order
    const neighbours = new Map();       // station id -> Set(station id)
    const lineNeighbours = new Map();   // station id -> Map(line id -> Set(station id))
    for (const s of doc.stations) {
      stationLines.set(s.id, new Set()); neighbours.set(s.id, new Set()); lineNeighbours.set(s.id, new Map());
    }
    const addLN = (s, lid, n) => {
      const m = lineNeighbours.get(s);
      if (!m.has(lid)) m.set(lid, new Set());
      m.get(lid).add(n);
    };
    for (const l of doc.lines) {
      if (l.hidden) continue;
      for (const br of l.branches) {
        for (let i = 0; i < br.length; i++) {
          if (!stations.has(br[i])) continue;
          stationLines.get(br[i]).add(l.id);
          if (i > 0 && stations.has(br[i - 1]) && br[i - 1] !== br[i]) {
            const k = edgeKey(br[i - 1], br[i]);
            if (!edgeLines.has(k)) edgeLines.set(k, []);
            const arr = edgeLines.get(k);
            if (!arr.includes(l.id)) arr.push(l.id);
            neighbours.get(br[i]).add(br[i - 1]);
            neighbours.get(br[i - 1]).add(br[i]);
            addLN(br[i], l.id, br[i - 1]);
            addLN(br[i - 1], l.id, br[i]);
          }
        }
      }
    }
    const connectorsAt = new Map();
    for (const c of doc.connectors) {
      for (const id of [c.a, c.b]) {
        if (!connectorsAt.has(id)) connectorsAt.set(id, []);
        connectorsAt.get(id).push(c);
      }
    }
    const lines = new Map(doc.lines.map(l => [l.id, l]));
    return { stations, stationLines, edgeLines, neighbours, lineNeighbours, connectorsAt, lines };
  }

  function isInterchange(st, idx) {
    if (st.interchange === 'yes') return true;
    if (st.interchange === 'no') return false;
    if ((idx.connectorsAt.get(st.id) || []).length > 0 || (st.extra && st.extra.length)) return true;
    // Several lines are an interchange unless they all run along the same
    // track through the station (e.g. Circle + H&C at Goldhawk Road).
    const ln = idx.lineNeighbours.get(st.id);
    if (!ln || ln.size < 2) return false;
    const sig = new Set([...ln.values()].map(set => [...set].sort().join(',')));
    return sig.size > 1;
  }

  /** Points of an edge oriented from a to b (station positions + bends). */
  function edgePoints(doc, idx, a, b) {
    const A = idx.stations.get(a), B = idx.stations.get(b);
    const key = edgeKey(a, b);
    const e = doc.edges[key] || {};
    let shape = e.shape || 'auto';
    if (shape === 'auto' && e.lines && !(e.via && e.via.length)) {
      const first = Object.keys(e.lines)[0];
      if (first) return ownLinePoints(doc, key, first, a, b);
    }
    if (shape === 'auto' && e.via && e.via.length) {
      const via = a < b ? e.via : e.via.slice().reverse();
      return [[A.x, A.y], ...via, [B.x, B.y]];
    }
    // Elbows are defined in canonical (sorted) direction so both traversals agree.
    const [P, Q] = a < b ? [A, B] : [B, A];
    if (shape === 'auto' && doc.settings && doc.settings.octilinear !== false && octiDeviation(Q.x - P.x, Q.y - P.y) > OCTI_TOLERANCE) {
      shape = bestElbow(idx, P, Q);
    }
    if (shape === 'elbow1' || shape === 'elbow2') {
      const pts = [[P.x, P.y], elbowPoint(P, Q, shape === 'elbow2'), [Q.x, Q.y]];
      return a < b ? pts : pts.reverse();
    }
    return [[A.x, A.y], [B.x, B.y]];
  }

  /** A line's own traced path along an edge (template tracks), oriented a -> b. */
  function ownLinePoints(doc, key, lineId, a, b) {
    const e = doc.edges[key];
    if (!e || !e.lines || !e.lines[lineId] || (e.shape && e.shape !== 'auto') || (e.via && e.via.length)) return null;
    const pts = e.lines[lineId].map(p => p.slice());
    return a < b ? pts : pts.reverse();
  }

  function elbowPoint(P, Q, diagonalFirst) {
    const dx = Q.x - P.x, dy = Q.y - P.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const sx = Math.sign(dx), sy = Math.sign(dy);
    if (adx >= ady) {
      return diagonalFirst ? [P.x + sx * ady, Q.y] : [P.x + sx * (adx - ady), P.y];
    }
    return diagonalFirst ? [Q.x, P.y + sy * adx] : [P.x, P.y + sy * (ady - adx)];
  }

  /* ---------------------------------------------------- 45-degree geometry */

  // Edges closer than this (degrees) to 0/45/90 are drawn as one straight segment.
  const OCTI_TOLERANCE = 1;
  const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);

  /** Angle (degrees) between a vector and the nearest horizontal/vertical/diagonal. */
  function octiDeviation(dx, dy) {
    if (!dx && !dy) return 0;
    const deg = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 45;
    return Math.min(deg, 45 - deg);
  }

  function nearestDir(dx, dy) {
    let best = DIRS[0], bd = -Infinity;
    const l = Math.hypot(dx, dy) || 1;
    for (const u of DIRS) {
      const d = (dx * u[0] + dy * u[1]) / l;
      if (d > bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Project p onto the nearest 0/45/90-degree ray from `from`. */
  function snapToRay(from, p) {
    const dx = p[0] - from[0], dy = p[1] - from[1];
    const u = nearestDir(dx, dy);
    const t = dx * u[0] + dy * u[1];
    return [from[0] + u[0] * t, from[1] + u[1] * t];
  }

  /**
   * Pick the elbow orientation that turns least where it meets the station's
   * other tracks, so a line keeps running straight through its stations.
   */
  function bestElbow(idx, P, Q) {
    let best = 'elbow1', bestCost = Infinity;
    for (const shape of ['elbow1', 'elbow2']) {
      const m = elbowPoint(P, Q, shape === 'elbow2');
      const cost = turnCost(idx, P, Q, m) + turnCost(idx, Q, P, m);
      if (cost < bestCost - 1e-6) { bestCost = cost; best = shape; }
    }
    return best;
  }

  function turnCost(idx, S, other, m) {
    let tx = m[0] - S.x, ty = m[1] - S.y;
    if (Math.hypot(tx, ty) < 0.5) { tx = other.x - S.x; ty = other.y - S.y; }
    const tl = Math.hypot(tx, ty) || 1;
    let cost = 0;
    for (const nid of idx.neighbours.get(S.id) || []) {
      const N = idx.stations.get(nid);
      if (!N || N === other) continue;
      const vx = N.x - S.x, vy = N.y - S.y, vl = Math.hypot(vx, vy) || 1;
      // 0 when the other track leaves in exactly the opposite direction (straight through)
      cost += 1 + (tx * vx + ty * vy) / (tl * vl);
    }
    return cost;
  }

  /**
   * Turn any layout into a schematic one: stations are nudged so tracks that are
   * nearly horizontal, vertical or diagonal become exactly so; every other track
   * gets a single 45-degree bend. Curved bend points are removed.
   */
  function octilinearize(doc, opts = {}) {
    const iterations = opts.iterations || 300;
    const idx = buildIndex(doc);
    const orig = new Map(doc.stations.map(s => [s.id, [s.x, s.y]]));
    const pos = new Map(doc.stations.map(s => [s.id, [s.x, s.y]]));
    const edges = [];
    for (const key of idx.edgeLines.keys()) {
      const [a, b] = key.split('|');
      const A = orig.get(a), B = orig.get(b);
      const e = doc.edges[key] || {};
      // How far does the drawn track bulge away from the straight chord?
      let bulge = 0, bend = null;
      for (const v of e.via || []) {
        const d = distToSegment(v, A, B);
        if (d > bulge) { bulge = d; bend = v; }
      }
      const dev = octiDeviation(B[0] - A[0], B[1] - A[1]);
      edges.push({ key, a, b, force: dev < 15 && bulge < 12, bend: bulge >= 12 ? bend : null });
    }

    // Relax: pull forced edges onto their nearest 0/45/90 direction, gently
    // anchored to where the stations started so the geography survives.
    const relax = (rounds) => {
      for (let it = 0; it < rounds; it++) {
        const delta = new Map(), count = new Map();
        const add = (id, x, y) => {
          const d = delta.get(id) || [0, 0];
          d[0] += x; d[1] += y;
          delta.set(id, d);
          count.set(id, (count.get(id) || 0) + 1);
        };
        for (const e of edges) {
          if (!e.force) continue;
          const A = pos.get(e.a), B = pos.get(e.b);
          const dx = B[0] - A[0], dy = B[1] - A[1];
          const u = nearestDir(dx, dy);
          const t = dx * u[0] + dy * u[1];
          const ex = dx - u[0] * t, ey = dy - u[1] * t; // sideways error
          add(e.a, ex / 2, ey / 2);
          add(e.b, -ex / 2, -ey / 2);
        }
        const anchor = it < rounds * 0.5 ? 0.02 : 0.002;
        for (const [id, p] of pos) {
          const d = delta.get(id), n = count.get(id) || 1, o = orig.get(id);
          if (d) { p[0] += 0.6 * d[0] / n; p[1] += 0.6 * d[1] / n; }
          p[0] += (o[0] - p[0]) * anchor;
          p[1] += (o[1] - p[1]) * anchor;
        }
      }
    };
    // Some constraints can't all hold at once (e.g. loops); the worst offenders
    // give up and become 45-degree elbows, then the rest are solved again.
    for (let round = 0; round < 4; round++) {
      relax(iterations);
      let changedForce = false;
      for (const e of edges) {
        if (!e.force) continue;
        const A = pos.get(e.a), B = pos.get(e.b);
        if (octiDeviation(B[0] - A[0], B[1] - A[1]) > 0.4) { e.force = false; changedForce = true; }
      }
      if (!changedForce) break;
    }
    for (const s of doc.stations) {
      const p = pos.get(s.id);
      const nx = Math.round(p[0]), ny = Math.round(p[1]);
      for (const x of s.extra || []) { x.x += nx - s.x; x.y += ny - s.y; }
      s.x = nx;
      s.y = ny;
    }

    // Choose a shape for every track segment.
    const idx2 = buildIndex(doc);
    for (const e of edges) {
      const [P, Q] = [idx2.stations.get(e.a), idx2.stations.get(e.b)]; // e.a < e.b
      const dev = octiDeviation(Q.x - P.x, Q.y - P.y);
      let shape;
      if (dev <= OCTI_TOLERANCE) shape = 'straight';
      else if (e.bend) {
        // keep the bend on the same side the original track curved
        const m1 = elbowPoint(P, Q, false), m2 = elbowPoint(P, Q, true);
        const d1 = Math.hypot(m1[0] - e.bend[0], m1[1] - e.bend[1]);
        const d2 = Math.hypot(m2[0] - e.bend[0], m2[1] - e.bend[1]);
        shape = d1 <= d2 ? 'elbow1' : 'elbow2';
      } else shape = bestElbow(idx2, P, Q);
      doc.edges[e.key] = { shape };
    }
    for (const k of Object.keys(doc.edges)) if (!idx2.edgeLines.has(k)) delete doc.edges[k];
    avoidStations(doc, idx2, edges);
    if (opts.river !== false && doc.river && doc.river.points.length > 1) doc.river.points = octilinearPolyline(doc.river.points);
    return doc;
  }

  /**
   * A straightened track can end up running straight through a station it does
   * not serve (e.g. the Elizabeth line over Oxford Circus). Flip its elbow, or
   * step it 45 degrees to one side for the length of the run, like TfL does.
   */
  function avoidStations(doc, idx, edges) {
    const all = doc.stations.map(s => [s.x, s.y, s.id]);
    const clearance = (doc.settings.lineWidth || 7) * 1.2;
    const blocked = (pts, a, b) => {
      let n = 0;
      for (const [x, y, id] of all) {
        if (id === a || id === b) continue;
        for (let i = 1; i < pts.length; i++) {
          if (distToSegment([x, y], pts[i - 1], pts[i]) < clearance) { n++; break; }
        }
      }
      return n;
    };
    for (const e of edges) {
      const P = idx.stations.get(e.a), Q = idx.stations.get(e.b);
      const cur = doc.edges[e.key];
      const pts = edgePoints(doc, idx, e.a, e.b);
      if (!blocked(pts, e.a, e.b)) continue;
      if (cur.shape === 'elbow1' || cur.shape === 'elbow2') {
        const flipped = cur.shape === 'elbow1' ? 'elbow2' : 'elbow1';
        const alt = [[P.x, P.y], elbowPoint(P, Q, flipped === 'elbow2'), [Q.x, Q.y]];
        if (!blocked(alt, e.a, e.b)) { cur.shape = flipped; continue; }
        continue;
      }
      const L = Math.hypot(Q.x - P.x, Q.y - P.y);
      const h = Math.min(16, L / 3);
      if (h < 6) continue;
      const u = [(Q.x - P.x) / L, (Q.y - P.y) / L];
      const nrm = [-u[1], u[0]];
      let sides = [-1, 1];
      if (e.bend) {
        const s = Math.sign((e.bend[0] - P.x) * nrm[0] + (e.bend[1] - P.y) * nrm[1]) || -1;
        sides = [s, -s];
      }
      for (const side of sides) {
        // (u + n) is a 45-degree step whatever direction the track runs in
        const k = h;
        const v1 = [Math.round(P.x + (u[0] + side * nrm[0]) * k), Math.round(P.y + (u[1] + side * nrm[1]) * k)];
        const v2 = [Math.round(Q.x + (-u[0] + side * nrm[0]) * k), Math.round(Q.y + (-u[1] + side * nrm[1]) * k)];
        const via = [v1, v2];
        if (!blocked([[P.x, P.y], ...via, [Q.x, Q.y]], e.a, e.b)) {
          doc.edges[e.key] = { shape: 'auto', via };
          break;
        }
      }
    }
  }

  function distToSegment(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const l2 = abx * abx + aby * aby;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - abx * t, p[1] - a[1] - aby * t);
  }

  /** Redraw a free-hand polyline (e.g. the river) with 0/45/90-degree segments. */
  function octilinearPolyline(pts) {
    const out = [pts[0].slice()];
    for (let i = 1; i < pts.length; i++) {
      const P = { x: out[out.length - 1][0], y: out[out.length - 1][1] }, Q = { x: pts[i][0], y: pts[i][1] };
      if (octiDeviation(Q.x - P.x, Q.y - P.y) > OCTI_TOLERANCE) {
        // alternate elbow orientation to follow the original wiggle
        out.push(elbowPoint(P, Q, i % 2 === 0).map(v => Math.round(v)));
      }
      out.push([Math.round(Q.x), Math.round(Q.y)]);
    }
    // drop points that sit in the middle of a straight run
    const clean = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = clean[clean.length - 1], b = out[i], c = out[i + 1];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1 || Math.abs(cross) < 1e-6 * Math.max(1, len)) continue;
      clean.push(b);
    }
    clean.push(out[out.length - 1]);
    return clean;
  }

  /** Move every object on the map by (dx, dy). */
  function translateDoc(doc, dx, dy) {
    const mv = p => { p[0] += dx; p[1] += dy; };
    for (const s of doc.stations) { s.x += dx; s.y += dy; for (const x of s.extra || []) { x.x += dx; x.y += dy; } }
    for (const e of Object.values(doc.edges)) {
      (e.via || []).forEach(mv);
      for (const pts of Object.values(e.lines || {})) pts.forEach(mv);
    }
    (doc.river.polygons || []).forEach(pl => pl.forEach(mv));
    for (const z of doc.zones) { z.points.forEach(mv); (z.rings || []).forEach(r => r.forEach(mv)); }
    (doc.river.points || []).forEach(mv);
    for (const o of doc.symbols) { o.x += dx; o.y += dy; }
    for (const o of doc.texts) { o.x += dx; o.y += dy; }
    doc.key.x += dx; doc.key.y += dy;
  }

  /** Bounding box of stations (incl. rough label extents), symbols, text and the key. */
  function contentBounds(doc) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const size = doc.settings.labelSize;
    for (const s of doc.stations) {
      add(s.x - 12, s.y - 12); add(s.x + 12, s.y + 12);
      const lines = s.label.lines || [s.name];
      const w = Math.max(...lines.map(t => t.length)) * size * 0.58 + 40;
      const lx = s.x + s.label.dx, ly = s.y + s.label.dy;
      const left = s.label.anchor === 'end' ? lx - w : s.label.anchor === 'middle' ? lx - w / 2 : lx;
      add(left, ly - size); add(left + w, ly + lines.length * size * 1.12);
    }
    for (const o of doc.symbols) { add(o.x - 15, o.y - 15); add(o.x + 15, o.y + 15); }
    for (const o of doc.texts) { add(o.x, o.y - (o.size || 16)); add(o.x + String(o.text).length * (o.size || 16) * 0.6, o.y + 8); }
    if (doc.key.visible && doc.settings.showKey) { add(doc.key.x, doc.key.y); add(doc.key.x + 320 * (doc.key.columns || 3), doc.key.y + 120); }
    if (!isFinite(x0)) return null;
    return { x0, y0, x1, y1 };
  }

  /** Resize the canvas to the content plus a margin. */
  function fitToContent(doc, margin = 40) {
    const b = contentBounds(doc);
    if (!b) return false;
    translateDoc(doc, Math.round(margin - b.x0), Math.round(margin - b.y0));
    doc.width = Math.round(b.x1 - b.x0 + margin * 2);
    doc.height = Math.round(b.y1 - b.y0 + margin * 2 + 30);
    return true;
  }

  window.TubeDoc = {
    translateDoc, contentBounds, fitToContent,
    octilinearize, octiDeviation, snapToRay, OCTI_TOLERANCE, ownLinePoints, TFL_STYLE,
    VERSION, TFL_PRESETS, uid, edgeKey, blankDoc, templateDoc, normalize, buildIndex, isInterchange,
    edgePoints, makeZones, defaultSettings,
  };
})();
