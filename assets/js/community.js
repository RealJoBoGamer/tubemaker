/* Community gallery: list, view, like, comment, remix and download maps. */
(function () {
  const API = window.TubeAPI, X = window.TubeExport, D = window.TubeDoc;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const state = { page: 1, sort: 'new', q: '', current: null };

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  function ago(ts) {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d)) return ts;
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' days ago';
    return d.toLocaleDateString();
  }

  async function load() {
    const g = $('#gallery');
    g.innerHTML = '<p class="muted">Loading maps…</p>';
    try {
      const mine = $('#mine').checked;
      const res = await API.list({ page: state.page, sort: state.sort, q: state.q });
      let maps = res.maps;
      if (mine) { const t = API.tokens(); maps = maps.filter(m => t[m.id]); }
      if (!maps.length) {
        g.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h3>No maps ${state.q ? 'match your search' : 'yet'}</h3>
          <p>Be the first — build a map in the <a href="index.html">editor</a> and press <b>Upload to community</b>.</p></div>`;
      } else {
        g.innerHTML = maps.map(m => `
          <article class="card" data-id="${esc(m.id)}" tabindex="0">
            <img src="${esc(m.thumbnail)}" alt="${esc(m.title)}" loading="lazy">
            <div class="body">
              <h3>${esc(m.title)}</h3>
              <div class="meta"><span>by ${esc(m.author)}</span><span>${ago(m.created_at)}</span></div>
              <div class="meta"><span>♥ ${m.likes}</span><span>👁 ${m.views}</span><span>${m.stations} stations · ${m.lines} lines</span>${m.remix_of ? '<span>remix</span>' : ''}</div>
            </div>
          </article>`).join('');
        g.querySelectorAll('.card').forEach(c => {
          c.onclick = () => openMap(c.dataset.id);
          c.onkeydown = e => { if (e.key === 'Enter') openMap(c.dataset.id); };
        });
      }
      renderPager(res.page, res.pages);
    } catch (e) {
      g.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h3>Community server unavailable</h3><p>${esc(e.message)}</p>
        <p class="small">The community page needs PHP + MySQL. See README.md for setup with phpMyAdmin.</p></div>`;
      $('#pager').innerHTML = '';
    }
  }

  function renderPager(page, pages) {
    const p = $('#pager');
    if (pages <= 1) { p.innerHTML = ''; return; }
    p.innerHTML = `<button class="btn" ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}">← Newer</button>
      <span class="muted">Page ${page} of ${pages}</span>
      <button class="btn" ${page >= pages ? 'disabled' : ''} data-p="${page + 1}">Older →</button>`;
    p.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { state.page = +b.dataset.p; load(); window.scrollTo(0, 0); });
  }

  async function openMap(id) {
    const dlg = $('#viewer');
    try {
      const { map } = await API.get(id);
      state.current = map;
      $('#vImg').src = map.thumbnail;
      $('#vImg').classList.remove('zoomed');
      $('#vTitle').textContent = map.title;
      $('#vMeta').innerHTML = `by <b>${esc(map.author)}</b> · ${ago(map.created_at)} · ${map.stations} stations · ${map.lines} lines · 👁 ${map.views}` +
        (map.remix_of ? ` · remix of <a href="#map=${esc(map.remix_of)}">another map</a>` : '');
      $('#vDesc').textContent = map.description || '';
      setLike(map.liked, map.likes);
      $('#vRemix').href = 'index.html?remix=' + encodeURIComponent(map.id);
      $('#vDelete').hidden = !API.tokens()[map.id];
      if (location.hash !== '#map=' + map.id) history.replaceState(null, '', '#map=' + map.id);
      if (!dlg.open) dlg.showModal();
      loadComments(map.id);
    } catch (e) {
      toast(e.message, 4000);
    }
  }

  function setLike(liked, likes) {
    const b = $('#vLike');
    b.textContent = `♥ ${liked ? 'Liked' : 'Like'} (${likes})`;
    b.classList.toggle('liked', !!liked);
  }

  async function loadComments(id) {
    const box = $('#comments');
    box.innerHTML = '<p class="muted small">Loading…</p>';
    try {
      const { comments } = await API.comments(id);
      box.innerHTML = comments.length ? comments.map(c => `<div class="comment"><b>${esc(c.author)}</b><time>${ago(c.created_at)}</time><p>${esc(c.body)}</p></div>`).join('')
        : '<p class="muted small">No comments yet.</p>';
    } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  function currentDoc() {
    const m = state.current;
    const doc = D.normalize(m.data);
    doc.title = m.title;
    return doc;
  }

  function setup() {
    let t;
    $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; state.page = 1; load(); });
    $('#mine').addEventListener('change', () => { state.page = 1; load(); });
    $('#closeViewer').onclick = () => $('#viewer').close();
    $('#viewer').addEventListener('close', () => { history.replaceState(null, '', location.pathname + location.search); });
    $('#vImg').onclick = e => e.target.classList.toggle('zoomed');
    $('#vLike').onclick = async () => {
      try { const r = await API.like(state.current.id); setLike(r.liked, r.likes); load(); } catch (e) { toast(e.message); }
    };
    $('#vPng').onclick = () => X.exportPNG(currentDoc(), 2).catch(e => toast(e.message));
    $('#vPdf').onclick = () => X.exportPDF(currentDoc(), 'a3').catch(e => toast(e.message));
    $('#vJson').onclick = () => X.exportJSON(currentDoc());
    $('#vCopy').onclick = async () => {
      const url = location.origin + location.pathname + '#map=' + state.current.id;
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { prompt('Copy this link:', url); }
    };
    $('#vDelete').onclick = async () => {
      if (!confirm('Delete this map from the community page? This cannot be undone.')) return;
      try { await API.remove(state.current.id); API.forgetToken(state.current.id); $('#viewer').close(); toast('Deleted'); load(); } catch (e) { toast(e.message); }
    };
    try { $('#cAuthor').value = localStorage.getItem('tubemaker.author') || ''; } catch (e) { /* ignore */ }
    $('#commentForm').onsubmit = async e => {
      e.preventDefault();
      const body = $('#cBody').value.trim();
      if (!body) return;
      try {
        await API.comment(state.current.id, $('#cAuthor').value.trim(), body);
        try { localStorage.setItem('tubemaker.author', $('#cAuthor').value.trim()); } catch (err) { /* ignore */ }
        $('#cBody').value = '';
        loadComments(state.current.id);
      } catch (err) { toast(err.message); }
    };
    window.addEventListener('hashchange', checkHash);
  }

  function checkHash() {
    const m = location.hash.match(/^#map=([\w-]+)/);
    if (m) openMap(m[1]);
  }

  setup();
  load();
  checkHash();
})();
