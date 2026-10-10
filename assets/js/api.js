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

  window.TubeAPI = {
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
