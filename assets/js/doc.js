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
      lineWidth: 7, labelSize: 11, snap: true, grid: 10,
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
  function templateDoc() {
    const t = window.TUBE_TEMPLATE;
    const doc = blankDoc();
    doc.title = 'London Underground (template)';
    doc.width = t.width;
    doc.height = t.height;
    doc.stations = t.stations.map(s => ({
      id: s.id, name: s.name, x: s.x, y: s.y,
      label: { lines: s.label.lines.slice(), dx: s.label.dx, dy: s.label.dy, anchor: s.label.anchor },
      nationalRail: !!s.nationalRail, airport: !!s.airport, river: s.river ? 'near' : 'none', coach: !!s.coach,
      stepFree: s.stepFree || 'none', interchange: 'auto', closed: false,
    }));
    for (const l of t.lines) {
      doc.lines.push({
        id: l.id, name: l.name, color: l.color, style: l.style, group: l.group || '',
        branches: l.branches.map(b => b.slice()), hidden: false,
      });
      for (const [k, via] of Object.entries(l.vias || {})) {
        const [a, b] = k.split('>');
        const key = edgeKey(a, b);
        if (doc.edges[key]) continue; // first line to provide a shape wins
        doc.edges[key] = { via: a < b ? via : via.slice().reverse() };
      }
    }
    const ids = new Set(doc.stations.map(s => s.id));
    doc.connectors = TEMPLATE_CONNECTORS.filter(([a, b]) => ids.has(a) && ids.has(b))
      .map(([a, b, type]) => ({ id: uid('c'), a, b, type }));
    // Zones centred between Oxford Circus and Bank.
    const byId = Object.fromEntries(doc.stations.map(s => [s.id, s]));
    const oc = byId['oxford-circus'], bank = byId['bank'];
    const cx = oc && bank ? (oc.x + bank.x) / 2 : doc.width / 2;
    const cy = oc && bank ? (oc.y + bank.y) / 2 + 60 : doc.height / 2;
    doc.zones = makeZones(cx, cy);
    doc.river = { points: (t.river || []).map(p => p.slice()), width: 22 };
    doc.key = { x: 16, y: doc.height - 316, visible: true, title: 'Key to lines', columns: 3 };
    doc.texts = [];
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
    }, s));
    out.edges = out.edges || {};
    out.connectors = out.connectors || [];
    out.zones = out.zones || [];
    out.river = out.river || { points: [], width: 22 };
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
    if ((idx.connectorsAt.get(st.id) || []).length > 0) return true;
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
    let pts;
    const shape = e.shape || 'auto';
    if (shape === 'auto' && e.via && e.via.length) {
      const via = a < b ? e.via : e.via.slice().reverse();
      pts = [[A.x, A.y], ...via, [B.x, B.y]];
    } else if (shape === 'elbow1' || shape === 'elbow2') {
      // elbows are defined in canonical (sorted) direction so both traversals agree
      const [P, Q] = a < b ? [A, B] : [B, A];
      const mid = elbowPoint(P, Q, shape === 'elbow2');
      pts = [[P.x, P.y], mid, [Q.x, Q.y]];
      if (!(a < b)) pts.reverse();
    } else {
      pts = [[A.x, A.y], [B.x, B.y]];
    }
    return pts;
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

  /** Move every object on the map by (dx, dy). */
  function translateDoc(doc, dx, dy) {
    const mv = p => { p[0] += dx; p[1] += dy; };
    for (const s of doc.stations) { s.x += dx; s.y += dy; }
    for (const e of Object.values(doc.edges)) (e.via || []).forEach(mv);
    for (const z of doc.zones) z.points.forEach(mv);
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
    VERSION, TFL_PRESETS, uid, edgeKey, blankDoc, templateDoc, normalize, buildIndex, isInterchange,
    edgePoints, makeZones, defaultSettings,
  };
})();
