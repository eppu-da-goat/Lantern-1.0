'use strict';
(() => {
  const api = window.lantern;
  document.querySelectorAll('[data-i]').forEach((n) => n.style.setProperty('--i', n.dataset.i));
  const $ = (id) => document.getElementById(id);
  const q = $('q');
  const bSearch = $('m-search');
  const bSummary = $('m-summary');
  let summary = false;
  let engineUrl = 'lantern://app/search.html?q=%s';
  let engineName = 'Lantern Search';

  function hint() {
    $('hint').replaceChildren(
      document.createTextNode(summary ? 'Summary reads the top pages and quotes the key points, each with its source.' : `Searching with ${engineName}. `),
    );
    if (!summary) {
      const b = document.createElement('b');
      b.textContent = 'Summary';
      $('hint').append('Switch to ', b, ' for cited key points.');
    }
  }
  function setMode(on, persist) {
    summary = on;
    bSearch.setAttribute('aria-pressed', String(!on));
    bSummary.setAttribute('aria-pressed', String(on));
    q.placeholder = on ? 'Ask anything' : 'Search privately';
    hint();
    if (persist && api) api.setSetting('summaryMode', on).catch(() => {});
  }
  bSearch.addEventListener('click', () => { setMode(false, true); q.focus(); });
  bSummary.addEventListener('click', () => { setMode(true, true); q.focus(); });

  function looksLikeUrl(t) {
    return /^(https?:\/\/)/i.test(t) || (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t));
  }
  function go(text, forceSummary) {
    const t = text.trim();
    if (!t) return;
    if (looksLikeUrl(t)) { location.href = /^https?:/i.test(t) ? t : 'https://' + t; return; }
    const useSummary = forceSummary ?? summary;
    location.href = useSummary
      ? 'lantern://app/search.html?q=' + encodeURIComponent(t) + '&summary=1'
      : engineUrl.replace('%s', encodeURIComponent(t));
  }
  $('search').addEventListener('submit', (e) => { e.preventDefault(); go(q.value); });
  if (window.LanternSuggest) {
    window.LanternSuggest.attach({
      input: q,
      anchor: q.closest('.pill'),
      onPick: (item, alt) => { if (item.type === 'url' && item.url) location.href = item.url; else { q.value = item.text; go(item.text, alt || undefined); } },
    });
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.altKey) { e.preventDefault(); go(q.value, true); } });

  // ---------- pinned statement: words light up with scroll progress ----------
  const lit = $('lit');
  const words = lit.textContent.trim().split(/\s+/);
  lit.replaceChildren();
  const hot = new Set(['yours.', 'stopped', 'encrypted,', 'nothing']);
  const spans = words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 'w' + (hot.has(w) ? ' hot-word' : '');
    s.textContent = w;
    lit.append(s, i < words.length - 1 ? ' ' : '');
    return s;
  });
  const pin = $('story');
  let ticking = false;
  function update() {
    ticking = false;
    const r = pin.getBoundingClientRect();
    const total = pin.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / (total || 1)));
    const n = Math.round(p * 1.15 * spans.length);
    spans.forEach((s, i) => {
      const on = i < n;
      s.classList.toggle('on', on);
      s.classList.toggle('hot', on && s.classList.contains('hot-word'));
    });
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) spans.forEach((s) => s.classList.add('on'));
  else update();

  // ---------- tracker counter ----------
  const blockedEl = $('blocked');
  function countTo(n) {
    const start = performance.now();
    const from = Number(blockedEl.dataset.v || 0);
    blockedEl.dataset.v = n;
    (function step(now) {
      const t = Math.min(1, (now - start) / 900);
      blockedEl.textContent = Math.round(from + (n - from) * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }

  // ---------- restore after a crash ----------
  function showRestore(count) {
    $('restore').hidden = false;
    $('restore-text').textContent = `Lantern didn't close properly. Restore ${count} tab${count === 1 ? '' : 's'}?`;
    $('restore-yes').onclick = async () => { await api.restoreSession(); $('restore').hidden = true; };
    $('restore-no').onclick = async () => { await api.dismissRestore(); $('restore').hidden = true; };
  }

  hint();
  if (api) {
    api.info().then((info) => {
      engineUrl = info.engineUrl;
      engineName = info.engines[info.settings.searchEngine];
      setMode(!!info.settings.summaryMode, false);
      countTo(info.blockedTotal || 0);
      if (info.crashed && info.lastSessionTabs) showRestore(info.lastSessionTabs);
    }).catch(() => {});
    setInterval(() => api.info().then((i) => { if (Number(blockedEl.dataset.v) !== i.blockedTotal) countTo(i.blockedTotal); }).catch(() => {}), 4000);
  }
})();

// ---------- Customize Lantern: theme, mode, background, shortcuts, toolbar ----------
(() => {
  const api = window.lantern;
  if (!api) return;
  const $ = (id) => document.getElementById(id);
  const T = window.LanternTheme;
  const COLORS = ['#f4efe6', '#e8eef7', '#e7f3ec', '#f3e8f5', '#1f2937', '#0f2a43', '#1d3b2a', '#3b1d33'];
  let s = null;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.25;
  }
  async function save(key, value) {
    try { s = await api.setSetting(key, value); } catch { return; }
    applyAll();
  }

  // ----- background -----
  function applyBackground() {
    const b = document.body;
    b.classList.remove('bg-glow', 'bg-none', 'bg-color', 'bg-image', 'on-dark');
    b.style.removeProperty('--user-bg');
    const bg = s.ntpBackground || 'glow';
    const img = `url("lantern://app/user/background?v=${s.bgVersion || 0}")`;
    if (s.bgVersion) { document.documentElement.style.setProperty('--user-image', img); $('bg-upload').classList.add('has-image'); }
    else { document.documentElement.style.removeProperty('--user-image'); $('bg-upload').classList.remove('has-image'); }
    $('bg-remove').hidden = !s.bgVersion;
    if (bg === 'image' && s.bgVersion) b.classList.add('bg-image', 'on-dark');
    else if (bg.startsWith('color:')) {
      const c = bg.slice(6);
      b.classList.add('bg-color');
      b.style.setProperty('--user-bg', c);
      if (isDark(c)) b.classList.add('on-dark');
    } else b.classList.add(bg === 'none' ? 'bg-none' : 'bg-glow');
    document.querySelectorAll('#bgs [data-bg]').forEach((t) => t.setAttribute('aria-checked', String(t.dataset.bg === bg)));
    $('bg-upload').setAttribute('aria-checked', String(bg === 'image'));
    document.querySelectorAll('#colors .color').forEach((c) => c.setAttribute('aria-checked', String(bg === 'color:' + c.dataset.c)));
  }

  // ----- shortcuts -----
  const favicon = (url) => { try { return `https://icons.duckduckgo.com/ip3/${new URL(url).hostname}.ico`; } catch { return ''; } };
  function renderShortcuts() {
    const nav = $('shortcuts');
    nav.replaceChildren();
    if (!s.showShortcuts) return;
    (s.shortcuts || []).forEach((sc, i) => {
      const a = el('a', 'tile');
      a.href = sc.url;
      const ic = el('span', 'ic');
      const img = el('img');
      img.alt = '';
      img.src = favicon(sc.url);
      img.onerror = () => { ic.replaceChildren(el('b', '', (sc.title || '?').charAt(0).toUpperCase())); };
      ic.appendChild(img);
      const edit = el('button', 'edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit ${sc.title}`);
      edit.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="4.5" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="15.5" r="1.5"/></svg>';
      edit.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openEditor(i); });
      a.append(ic, el('span', 'nm', sc.title), edit);
      nav.appendChild(a);
    });
    if ((s.shortcuts || []).length < 12) {
      const add = el('button', 'tile add');
      add.type = 'button';
      add.innerHTML = '<span class="ic"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg></span>';
      add.appendChild(el('span', 'nm', 'Add shortcut'));
      add.addEventListener('click', () => openEditor(-1));
      nav.appendChild(add);
    }
  }
  let editing = -1;
  function openEditor(i) {
    editing = i;
    const sc = i >= 0 ? s.shortcuts[i] : { title: '', url: '' };
    $('sc-dialog-title').textContent = i >= 0 ? 'Edit shortcut' : 'Add shortcut';
    $('sc-name').value = sc.title;
    $('sc-url').value = sc.url;
    $('sc-remove').hidden = i < 0;
    $('sc-error').hidden = true;
    $('sc-dialog').hidden = false;
    $('sc-name').focus();
  }
  function closeEditor() { $('sc-dialog').hidden = true; }
  $('sc-cancel').addEventListener('click', closeEditor);
  $('sc-dialog').addEventListener('click', (e) => { if (e.target.id === 'sc-dialog') closeEditor(); });
  $('sc-remove').addEventListener('click', async () => {
    const list = s.shortcuts.filter((_, j) => j !== editing);
    closeEditor();
    await save('shortcuts', list);
  });
  $('sc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = $('sc-url').value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (!host || !host.includes('.')) { $('sc-error').hidden = false; $('sc-error').textContent = 'Enter a web address, like wikipedia.org'; return; }
    const title = $('sc-name').value.trim() || host.replace(/^www\./, '');
    const list = (s.shortcuts || []).slice();
    if (editing >= 0) list[editing] = { title, url }; else list.push({ title, url });
    closeEditor();
    await save('shortcuts', list);
  });

  // ----- panel -----
  function buildPanel() {
    const box = $('themes');
    box.replaceChildren();
    Object.entries(T.PRESETS).forEach(([key, p]) => {
      const b = el('button', 'theme');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.key = key;
      const dot = el('span', 'dot');
      dot.style.background = p.light[0];
      dot.style.setProperty('--d1', p.light[0]);
      dot.style.setProperty('--d2', p.light[1]);
      b.append(dot, el('span', '', p.name));
      b.addEventListener('click', () => save('themeColor', key));
      box.appendChild(b);
    });
    const colors = $('colors');
    colors.replaceChildren();
    COLORS.forEach((c) => {
      const b = el('button', 'color');
      b.type = 'button';
      b.dataset.c = c;
      b.style.background = c;
      b.setAttribute('aria-label', `Solid colour ${c}`);
      b.addEventListener('click', () => save('ntpBackground', 'color:' + c));
      colors.appendChild(b);
    });
    document.querySelectorAll('#bgs [data-bg]').forEach((t) => t.addEventListener('click', () => save('ntpBackground', t.dataset.bg)));
    $('bg-upload').addEventListener('click', async () => {
      if (s.bgVersion && s.ntpBackground !== 'image') return save('ntpBackground', 'image');
      try { s = await api.pickBackground(); applyAll(); } catch {}
    });
    $('bg-remove').addEventListener('click', async () => { s = await api.removeBackground(); applyAll(); });
    document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => save('theme', b.dataset.v)));
    $('t-shortcuts').addEventListener('change', (e) => save('showShortcuts', e.target.checked));
    $('t-home').addEventListener('change', (e) => save('showHomeButton', e.target.checked));
    $('t-summary').addEventListener('change', (e) => save('toolbarSummary', e.target.checked));
    $('t-shield').addEventListener('change', (e) => save('toolbarShield', e.target.checked));
  }
  function syncPanel() {
    document.querySelectorAll('#themes .theme').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === s.themeColor)));
    document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.theme)));
    $('t-shortcuts').checked = s.showShortcuts !== false;
    $('t-home').checked = s.showHomeButton !== false;
    $('t-summary').checked = s.toolbarSummary !== false;
    $('t-shield').checked = s.toolbarShield !== false;
  }
  function openPanel() {
    $('panel').classList.remove('closing');
    $('panel').hidden = false;
    $('scrim').hidden = false;
    $('panel-close').focus();
  }
  function closePanel() {
    const p = $('panel');
    if (p.hidden) return;
    p.classList.add('closing');
    $('scrim').hidden = true;
    setTimeout(() => { p.hidden = true; p.classList.remove('closing'); }, 280);
    if (location.hash === '#customize') history.replaceState(null, '', location.pathname);
  }
  $('customize').addEventListener('click', openPanel);
  $('panel-close').addEventListener('click', closePanel);
  $('scrim').addEventListener('click', closePanel);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeEditor(); closePanel(); } });

  function applyAll() {
    T.apply(s.themeColor);
    applyBackground();
    renderShortcuts();
    syncPanel();
  }

  api.info().then((info) => {
    s = info.settings;
    buildPanel();
    applyAll();
    if (location.hash === '#customize') openPanel();
  }).catch(() => {});
  addEventListener('hashchange', () => { if (location.hash === '#customize') openPanel(); });
})();

// Private windows say so on the New Tab page.
(() => {
  const api = window.lantern;
  if (!api) return;
  api.info().then((i) => {
    if (!i.private) return;
    document.body.classList.add('private');
    const h = document.querySelector('.headline');
    if (h) {
      h.setAttribute('aria-label', 'You\'re browsing privately.');
      h.innerHTML = '<span class="line"><span class="word" data-i="1" style="--i:1">You\'re</span> <span class="word" data-i="2" style="--i:2">browsing</span></span><span class="line"><span class="word gradient-text" data-i="3" style="--i:3">privately.</span></span>';
    }
    const hint = document.getElementById('hint');
    if (hint) {
      hint.textContent = 'Pages, searches and cookies from this window are forgotten when you close it. Downloads and bookmarks you make are kept.';
      new MutationObserver(() => { if (!hint.textContent.startsWith('Pages, searches')) hint.textContent = 'Pages, searches and cookies from this window are forgotten when you close it. Downloads and bookmarks you make are kept.'; }).observe(hint, { childList: true });
    }
  }).catch(() => {});
})();
