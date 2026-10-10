/* Thin client for api/maps.php */
(function () {
  const BASE = 'api/maps.php';

  async function call(action, { method = 'GET', params = {}, body = null } = {}) {
    const qs = new URLSearchParams(Object.assign({ action }, params)).toString();
    let res;
    try {
      res = await fetch(`${BASE}?${qs}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : null,
      });
    } catch (e) {
      throw new Error('Could not reach the server. Is the PHP backend running?');
    }
    let data;
    try { data = await res.json(); } catch (e) {
      throw new Error(`Server error (${res.status}). Check that PHP is enabled and api/config.php is correct.`);
    }
    if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Edit tokens for maps uploaded from this browser
  const TOKENS_KEY = 'tubemaker.tokens';
  function tokens() {
    try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveToken(id, token) {
    const t = tokens(); t[id] = token;
    try { localStorage.setItem(TOKENS_KEY, JSON.stringify(t)); } catch (e) { /* storage unavailable */ }
  }
  function forgetToken(id) {
    const t = tokens(); delete t[id];
    try { localStorage.setItem(TOKENS_KEY, JSON.stringify(t)); } catch (e) { /* storage unavailable */ }
  }

  /** Look a station up in the TfL Unified API (api.tfl.gov.uk allows browser requests). */
  async function tflLookup(name) {
    const base = 'https://api.tfl.gov.uk';
    const modes = 'tube,dlr,overground,elizabeth-line';
    const q = encodeURIComponent(name.replace(/\s+/g, ' ').trim());
    const res = await fetch(`${base}/StopPoint/Search/${q}?modes=${modes}&maxResults=5`);
    if (!res.ok) throw new Error(`TfL API error (${res.status})`);
    const found = (await res.json()).matches || [];
    if (!found.length) throw new Error(`TfL has no station called "${name}"`);
    const det = await fetch(`${base}/StopPoint/${encodeURIComponent(found[0].id)}`);
    if (!det.ok) throw new Error(`TfL API error (${det.status})`);
    const sp = await det.json();
    const props = sp.additionalProperties || [];
    const prop = key => (props.find(p => p.key === key) || {}).value;
    // the hub record lists child stations; collect modes and lines from all of them
    const all = [sp, ...(sp.children || [])];
    const modesAll = new Set(all.flatMap(c => c.modes || []));
    // rail lines only (hub records also list bus routes)
    const railModes = new Set(['tube', 'dlr', 'overground', 'elizabeth-line', 'national-rail', 'tram']);
    const lines = [...new Set(all.filter(c => (c.modes || []).some(m => railModes.has(m)))
      .flatMap(c => (c.lineModeGroups || []).filter(g => railModes.has(g.modeName)).flatMap(g => g.lineIdentifier || [])))]
      .map(id => id.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()));
    return {
      naptan: sp.naptanId || sp.id,
      name: (sp.commonName || found[0].name).replace(/ (Underground|DLR|Rail) Station$/, ''),
      zone: prop('Zone') || (all.map(c => ((c.additionalProperties || []).find(p => p.key === 'Zone') || {}).value).find(Boolean)) || '',
      nationalRail: modesAll.has('national-rail'),
      lift: prop('AccessViaLift'),
      lines,
    };
  }

  window.TubeAPI = {
    tflLookup,
    list: (params) => call('list', { params }),
    get: (id) => call('get', { params: { id } }),
    create: (body) => call('create', { method: 'POST', body }),
    update: (body) => call('update', { method: 'POST', body }),
    remove: (id) => call('delete', { method: 'POST', body: { id, token: tokens()[id] } }),
    like: (id) => call('like', { method: 'POST', body: { id } }),
    comments: (id) => call('comments', { params: { id } }),
    comment: (id, author, body) => call('comment', { method: 'POST', body: { id, author, body } }),
    presets: () => call('presets'),
    savePreset: (p) => call('preset', { method: 'POST', body: p }),
    tokens, saveToken, forgetToken,
  };
})();
