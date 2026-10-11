/* Journey planner: full London map (Tube, DLR, Elizabeth line, Overground, Thameslink,
 * Trams, Cable Car). Shows everything until a journey is chosen, then only the
 * stations passed through or changed at and the track used between them. */
(function () {
  const D = window.TubeDoc, R = window.TubeRender;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const API = 'https://api.tfl.gov.uk';
  const MODES = [
    ['tube', 'Underground'], ['dlr', 'DLR'], ['elizabeth-line', 'Elizabeth line'], ['overground', 'London Overground'],
    ['national-rail', 'National Rail / Thameslink'], ['tram', 'Trams'], ['cable-car', 'Cable Car'], ['bus', 'Bus'], ['river-bus', 'River bus'],
  ];
  const DEFAULT_MODES = new Set(['tube', 'dlr', 'elizabeth-line', 'overground', 'national-rail', 'tram', 'cable-car']);

  /* ------------------------------------------------------------- the map */

  const doc = D.normalize(D.templateDoc(window.TUBE_TEMPLATE_FULL));
  doc.title = '';
  doc.key = Object.assign(doc.key, { title: 'Key to lines', columns: 3 });
  const idx = D.buildIndex(doc);
  const lineById = new Map(doc.lines.map(l => [l.id, l]));

  // lookups: NaPTAN id and normalised names -> station id
  const norm = s => String(s || '').toLowerCase()
    .replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ')
    .replace(/\b(underground|dlr|rail|tram|station|stop|london overground|elizabeth line|ifs cloud|h and c line)\b/g, ' ')
    .replace(/^\s*london\s+(?=(euston|liverpool street|bridge|paddington|victoria|waterloo|blackfriars|st pancras|kings cross))/, '')
    .replace(/\bst\b\.?/g, 'st').replace(/[^a-z0-9]+/g, ' ').trim();
  const byNaptan = new Map(), byName = new Map();
  for (const st of doc.stations) {
    for (const n of st.naptans && st.naptans.length ? st.naptans : [st.naptan]) if (n) byNaptan.set(n, st.id);
    for (const name of [st.name, st.label.lines.join(' ')]) {
      const k = norm(name);
      if (k && !byName.has(k)) byName.set(k, st.id);
    }
  }
  byName.set(norm("St Pancras International"), byName.get(norm("King's Cross St. Pancras")));
  byName.set(norm("King's Cross"), byName.get(norm("King's Cross St. Pancras")));

  function stationFrom(point) {
    if (!point) return null;
    const ids = [point.naptanId, point.id, point.stationId, point.topMostParentId].filter(Boolean);
    for (const id of ids) if (byNaptan.has(id)) return byNaptan.get(id);
    const k = norm(point.commonName || point.name);
    if (byName.has(k)) return byName.get(k);
    // "Paddington (H&C Line)-Underground" style names
    for (const [name, id] of byName) if (k && (k.startsWith(name + ' ') || name === k.split(' - ')[0])) return id;
    return null;
  }

  function resolveTyped(text) {
    const k = norm(text);
    if (!k) return null;
    if (byName.has(k)) return byName.get(k);
    const starts = [...byName.keys()].filter(n => n.startsWith(k));
    if (starts.length) return byName.get(starts.sort((a, b) => a.length - b.length)[0]);
    const inc = [...byName.keys()].filter(n => n.includes(k));
    return inc.length ? byName.get(inc.sort((a, b) => a.length - b.length)[0]) : null;
  }

  // per-line adjacency (for filling in stations an express leg passes through)
  const lineAdj = new Map();
  for (const l of doc.lines) {
    const adj = new Map();
    for (const br of l.branches) {
      for (let i = 1; i < br.length; i++) {
        if (!adj.has(br[i - 1])) adj.set(br[i - 1], new Set());
        if (!adj.has(br[i])) adj.set(br[i], new Set());
        adj.get(br[i - 1]).add(br[i]);
        adj.get(br[i]).add(br[i - 1]);
      }
    }
    lineAdj.set(l.id, adj);
  }
  function linePath(lid, a, b) {
    const adj = lineAdj.get(lid);
    if (!adj || !adj.has(a) || !adj.has(b)) return null;
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const cur = q.shift();
      if (cur === b) break;
      for (const n of adj.get(cur)) if (!prev.has(n)) { prev.set(n, cur); q.push(n); }
    }
    if (!prev.has(b)) return null;
    const path = [];
    for (let c = b; c != null; c = prev.get(c)) path.unshift(c);
    return path;
  }

  /* --------------------------------------------------------------- view */

  const svg = $('#canvas'), viewport = $('#viewport'), wrap = $('#canvasWrap');
  const view = { x: 0, y: 0, k: 0.5 };
  let focus = null, fadeRest = false;
  let baseMarkup = null;

  function render() {
    if (!focus) {
      if (!baseMarkup) baseMarkup = R.renderInner(doc, { showTitle: false });
      viewport.innerHTML = baseMarkup;
    } else {
      // the key would cover the route; the journey list shows the lines used
      const top = R.renderInner(doc, { focus, showTitle: false, overlay: fadeRest, hideKey: true });
      viewport.innerHTML = fadeRest
        ? R.renderInner(doc, { showTitle: false, hideKey: true }) + `<rect x="0" y="0" width="${doc.width}" height="${doc.height}" fill="#fff" fill-opacity="0.82"/>` + top
        : top;
    }
    apply();
  }
  function apply() { viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
  function fitTo(x0, y0, x1, y1, pad = 60) {
    const r = wrap.getBoundingClientRect();
    const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    view.k = Math.min(4, Math.min(r.width / w, r.height / h));
    view.x = (r.width - (x0 + x1) * view.k) / 2;
    view.y = (r.height - (y0 + y1) * view.k) / 2;
    apply();
  }
  const fitAll = () => fitTo(0, 0, doc.width, doc.height, 10);

  function zoomAt(f, cx, cy) {
    const k = Math.min(10, Math.max(0.1, view.k * f));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    apply();
  }
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', e => { drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    view.x = drag.vx + dx; view.y = drag.vy + dy; apply();
  });
  svg.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    // click a station to fill From, then To
    const r = svg.getBoundingClientRect();
    const wx = (e.clientX - r.left - view.x) / view.k, wy = (e.clientY - r.top - view.y) / view.k;
    let best = null;
    for (const st of doc.stations) {
      const dd = Math.hypot(st.x - wx, st.y - wy);
      if (dd < 14 / Math.min(1, view.k) && (!best || dd < best.d)) best = { st, d: dd };
    }
    if (best) {
      const target = !$('#from').value ? $('#from') : $('#to');
      target.value = best.st.name;
      toast(`${target.id === 'from' ? 'From' : 'To'}: ${best.st.name}`);
    }
  });
  document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
    if (b.dataset.zoom === 'fit') return focus ? fitFocus() : fitAll();
    const r = wrap.getBoundingClientRect();
    zoomAt(+b.dataset.zoom, r.width / 2, r.height / 2);
  });

  function toast(msg, ms = 2500) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  const status = m => { $('#status').textContent = m; };

  /* ------------------------------------------------------ journeys -> map */

  function lineColor(lid, mode) {
    const l = lineById.get(lid);
    if (l) return l.color;
    return { bus: '#dc241f', 'river-bus': '#00a0e2', 'national-rail': '#8a8f98', walking: '#555' }[mode] || '#8a8f98';
  }

  /** Build the focus (what to draw) for one journey. */
  function focusFor(j) {
    const f = { stations: new Set(), segs: new Map(), lines: new Set(), walks: [], extra: [], ends: [] };
    const addSeg = (a, b, lid) => {
      const k = D.edgeKey(a, b);
      if (!f.segs.has(k)) f.segs.set(k, new Set());
      f.segs.get(k).add(lid);
    };
    for (const leg of j.legs) {
      const st = leg.stations;
      st.forEach(s => f.stations.add(s));
      if (leg.mode === 'walking') {
        if (leg.from && leg.to && leg.from !== leg.to) f.walks.push([leg.from, leg.to]);
        continue;
      }
      const onMap = leg.lineId && lineAdj.has(leg.lineId);
      if (onMap) f.lines.add(leg.lineId);
      for (let i = 1; i < st.length; i++) {
        const a = st[i - 1], b = st[i];
        const path = onMap ? linePath(leg.lineId, a, b) : null;
        if (path) {
          for (let k = 1; k < path.length; k++) { addSeg(path[k - 1], path[k], leg.lineId); f.stations.add(path[k]); }
        } else {
          f.extra.push([a, b, leg.color]);
        }
      }
    }
    const first = j.legs.find(l => l.stations.length), last = [...j.legs].reverse().find(l => l.stations.length);
    if (first) f.ends.push(first.stations[0]);
    if (last) f.ends.push(last.stations[last.stations.length - 1]);
    return f;
  }

  function fitFocus() {
    if (!focus) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of focus.stations) {
      const s = idx.stations.get(id);
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
    }
    if (isFinite(x0)) fitTo(x0 - 60, y0 - 40, x1 + 160, y1 + 40, 40);
  }

  function showJourney(j) {
    focus = focusFor(j);
    $('#showAll').hidden = false;
    $('#fadeRow').hidden = false;
    render();
    fitFocus();
  }
  function showAll() {
    focus = null;
    $('#showAll').hidden = true;
    $('#fadeRow').hidden = true;
    document.querySelectorAll('.journey.active').forEach(e => e.classList.remove('active'));
    render();
    fitAll();
  }
  $('#showAll').onclick = showAll;
  $('#fadeRest').onchange = e => { fadeRest = e.target.checked; render(); };

  /* ---------------------------------------------------- TfL journey planner */

  function selectedModes() {
    return [...document.querySelectorAll('#modeList input:checked')].map(i => i.value);
  }

  async function tflJourney(fromSt, toSt) {
    const from = idx.stations.get(fromSt), to = idx.stations.get(toSt);
    const pick = st => (st.naptans && st.naptans[0]) || st.naptan || encodeURIComponent(st.name);
    const params = new URLSearchParams({ mode: [...selectedModes(), 'walking'].join(','), journeyPreference: $('#prefer').value });
    const when = $('#when').value, time = $('#time').value;
    if (when !== 'now' && time) {
      params.set('time', time.replace(':', ''));
      params.set('timeIs', when === 'arrive' ? 'Arriving' : 'Departing');
    }
    if ($('#stepFree').checked) params.set('accessibilityPreference', 'StepFreeToPlatform');
    let url = `${API}/Journey/JourneyResults/${pick(from)}/to/${pick(to)}?${params}`;
    let res = await fetch(url);
    let data = await res.json().catch(() => ({}));
    // TfL asks to disambiguate when an id matches several places: take its first suggestion
    if (data && data.$type && data.$type.includes('DisambiguationResult')) {
      const opt = key => ((data[key] || {}).disambiguationOptions || [])[0];
      const f = opt('fromLocationDisambiguation'), t = opt('toLocationDisambiguation');
      url = `${API}/Journey/JourneyResults/${f ? encodeURIComponent(f.parameterValue) : pick(from)}/to/${t ? encodeURIComponent(t.parameterValue) : pick(to)}?${params}`;
      res = await fetch(url);
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok || !data.journeys) throw new Error((data && data.message) || `TfL journey planner error (${res.status})`);
    return data.journeys.map(j => ({
      source: 'tfl',
      duration: j.duration,
      start: j.startDateTime, arrival: j.arrivalDateTime,
      fare: j.fare && j.fare.totalCost != null ? j.fare.totalCost : null,
      legs: j.legs.map(leg => {
        const mode = leg.mode && leg.mode.id;
        const ro = (leg.routeOptions || [])[0] || {};
        const lineId = ro.lineIdentifier ? ro.lineIdentifier.id : null;
        const pts = [leg.departurePoint, ...((leg.path && leg.path.stopPoints) || []), leg.arrivalPoint];
        const stations = [];
        for (const p of pts) {
          const id = stationFrom(p);
          if (id && stations[stations.length - 1] !== id) stations.push(id);
        }
        return {
          mode, lineId, lineName: ro.name || (leg.mode && leg.mode.name) || mode,
          color: lineColor(lineId, mode), duration: leg.duration,
          from: stationFrom(leg.departurePoint), to: stationFrom(leg.arrivalPoint),
          fromName: leg.departurePoint && leg.departurePoint.commonName, toName: leg.arrivalPoint && leg.arrivalPoint.commonName,
          instruction: leg.instruction && leg.instruction.summary,
          stations: mode === 'walking' ? stations.filter((s, i, a) => i === 0 || i === a.length - 1) : stations,
          departure: leg.departureTime,
        };
      }),
    }));
  }

  /* --------------------------------------------------- map-only planner */

  // Dijkstra over (station, line) states with ride time from map distance,
  // a penalty for changing lines and walking links from the map's connectors.
  function localJourney(fromSt, toSt) {
    // map units are PDF points; ~32 points of map per minute of travel is a fair London average
    const MIN_PER_UNIT = 1 / 32, DWELL = 0.6, CHANGE = 5, WALK = 6;
    const allowed = new Set(selectedModes());
    const modeOf = l => (l.id === 'dlr' ? 'dlr' : l.id === 'elizabeth' ? 'elizabeth-line' : l.group === 'London Overground' ? 'overground'
      : l.id === 'thameslink' ? 'national-rail' : l.id === 'tram' ? 'tram' : l.id === 'london-cable-car' ? 'cable-car' : 'tube');
    const lines = doc.lines.filter(l => allowed.has(modeOf(l)));
    const key = (s, l) => s + '@' + (l || '');
    const dist = new Map([[key(fromSt, null), 0]]), prev = new Map();
    const pq = [[0, fromSt, null]];
    const walkAdj = new Map();
    for (const c of doc.connectors) {
      for (const [a, b] of [[c.a, c.b], [c.b, c.a]]) {
        if (!walkAdj.has(a)) walkAdj.set(a, []);
        walkAdj.get(a).push(b);
      }
    }
    let best = null;
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, s, l] = pq.shift();
      if (d > (dist.get(key(s, l)) ?? Infinity)) continue;
      if (s === toSt) { best = key(s, l); break; }
      const relax = (s2, l2, cost) => {
        const k = key(s2, l2), nd = d + cost;
        if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, key(s, l)); pq.push([nd, s2, l2]); }
      };
      for (const line of lines) {
        const adj = lineAdj.get(line.id).get(s);
        if (!adj) continue;
        for (const n of adj) {
          const A = idx.stations.get(s), B = idx.stations.get(n);
          relax(n, line.id, Math.hypot(A.x - B.x, A.y - B.y) * MIN_PER_UNIT + DWELL + (l && l !== line.id ? CHANGE : l ? 0 : 2));
        }
      }
      for (const n of walkAdj.get(s) || []) relax(n, 'walk', WALK);
    }
    if (!best) throw new Error('No route found on the map with the selected modes.');
    const states = [];
    for (let k = best; k; k = prev.get(k)) states.unshift(k.split('@'));
    const legs = [];
    for (let i = 1; i < states.length; i++) {
      const [s0] = states[i - 1], [s1, l1] = states[i];
      const lid = l1 === 'walk' ? null : l1;
      const last = legs[legs.length - 1];
      if (last && last.lineId === lid && lid) { last.stations.push(s1); last.to = s1; continue; }
      legs.push({
        mode: lid ? modeOf(lineById.get(lid)) : 'walking', lineId: lid, lineName: lid ? lineById.get(lid).name : 'Walk',
        color: lid ? lineById.get(lid).color : '#555', from: s0, to: s1, stations: [s0, s1],
      });
    }
    for (const leg of legs) {
      leg.fromName = idx.stations.get(leg.from).name; leg.toName = idx.stations.get(leg.to).name;
      leg.instruction = leg.mode === 'walking' ? `Walk to ${leg.toName}` : `${leg.lineName} to ${leg.toName}`;
    }
    return [{ source: 'map', duration: Math.round(dist.get(best)), legs }];
  }

  /* -------------------------------------------------------------- results */

  const hhmm = iso => (iso ? iso.slice(11, 16) : '');
  function renderResults(journeys, note) {
    const box = $('#results');
    box.innerHTML = (note ? `<p class="note">${esc(note)}</p>` : '') + journeys.map((j, i) => {
      const chips = j.legs.filter(l => l.mode !== 'walking' || l.duration > 1).map(l => l.mode === 'walking'
        ? `<span class="chip walk">Walk${l.duration ? ' ' + l.duration + 'm' : ''}</span>`
        : `<span class="chip" style="--c:${esc(l.color)}">${esc(l.lineName)}</span>`).join('');
      const legs = j.legs.map(l => {
        const names = l.stations.map(id => idx.stations.get(id).name);
        const middle = names.slice(1, -1);
        return `<li class="leg ${l.mode === 'walking' ? 'walk' : ''}" style="--c:${esc(l.color)}"><span class="bar"></span><div>
          <b>${esc(l.instruction || (l.lineName + ' to ' + (l.toName || '')))}</b>
          <div class="stops">${esc(l.fromName || names[0] || '')} → ${esc(l.toName || names[names.length - 1] || '')}${l.duration ? ` · ${l.duration} min` : ''}${l.departure ? ` · ${hhmm(l.departure)}` : ''}</div>
          ${middle.length ? `<details><summary>${middle.length} stop${middle.length > 1 ? 's' : ''} in between</summary><ol>${middle.map(n => `<li>${esc(n)}</li>`).join('')}</ol></details>` : ''}
        </div></li>`;
      }).join('');
      return `<div class="journey" data-i="${i}">
        <div class="top"><span class="dur">${j.duration} min</span><span class="times">${j.start ? `${hhmm(j.start)} → ${hhmm(j.arrival)}` : (j.source === 'map' ? 'estimate from the map' : '')}</span></div>
        <div class="chips">${chips}</div>
        ${j.fare != null ? `<div class="fare">Fare £${(j.fare / 100).toFixed(2)}</div>` : ''}
        <ul class="legs">${legs}</ul></div>`;
    }).join('');
    box.querySelectorAll('.journey').forEach(el => el.onclick = e => {
      if (e.target.closest('details')) return;
      box.querySelectorAll('.journey').forEach(x => x.classList.toggle('active', x === el));
      showJourney(journeys[+el.dataset.i]);
    });
    const firstEl = box.querySelector('.journey');
    if (firstEl) firstEl.click();
  }

  async function plan(e) {
    e && e.preventDefault();
    const a = resolveTyped($('#from').value), b = resolveTyped($('#to').value);
    if (!a || !b) { toast(`Can't find ${!a ? 'the starting' : 'the destination'} station on the map`); return; }
    if (a === b) { toast('From and To are the same station'); return; }
    $('#from').value = idx.stations.get(a).name;
    $('#to').value = idx.stations.get(b).name;
    $('#results').innerHTML = '<p class="note">Planning…</p>';
    status('Planning…');
    try {
      if (!$('#useTfl').checked) throw Object.assign(new Error('map'), { local: true });
      const js = await tflJourney(a, b);
      if (!js.length) throw new Error('TfL found no journeys');
      renderResults(js);
      status(`${js.length} journeys from TfL`);
    } catch (err) {
      try {
        const js = localJourney(a, b);
        renderResults(js, err.local ? 'Planned on the map (times are estimates).' : `TfL journey planner unavailable (${err.message}) – showing a route planned on the map instead.`);
        status('Route planned on the map');
      } catch (err2) {
        $('#results').innerHTML = `<p class="note">${esc(err2.message)}</p>`;
        status('No route');
      }
    }
    const u = new URL(location.href);
    u.searchParams.set('from', idx.stations.get(a).name); u.searchParams.set('to', idx.stations.get(b).name);
    history.replaceState(null, '', u);
  }

  /* ---------------------------------------------------------------- setup */

  $('#modeList').innerHTML = MODES.map(([id, name]) =>
    `<label class="check small"><input type="checkbox" value="${id}" ${DEFAULT_MODES.has(id) ? 'checked' : ''}> ${esc(name)}</label>`).join('');
  $('#stationList').innerHTML = [...new Set(doc.stations.map(s => s.name))].sort().map(n => `<option value="${esc(n)}">`).join('');
  $('#planForm').addEventListener('submit', plan);
  $('#swap').onclick = () => { const f = $('#from').value; $('#from').value = $('#to').value; $('#to').value = f; };
  window.addEventListener('resize', apply);

  (async () => {
    try { await Promise.race([document.fonts.load("12px 'London Tube'"), new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* ignore */ }
    render();
    fitAll();
    status(`${doc.stations.length} stations · ${doc.lines.length} lines – type two stations or click them on the map`);
    const q = new URLSearchParams(location.search);
    if (q.get('from') && q.get('to')) { $('#from').value = q.get('from'); $('#to').value = q.get('to'); plan(); }
  })();

  window.TubePlanner = { doc, plan, showAll, localJourney, focusFor };
})();
