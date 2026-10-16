'use strict';
(() => {
  const api = window.lanternUI;
  const params = new URLSearchParams(location.search);
  const platform = params.get('platform') || '';
  document.body.classList.add(platform === 'darwin' ? 'mac' : 'overlay');
  if (params.get('private')) { document.body.classList.add('private'); document.getElementById('private-badge').hidden = false; }
  document.documentElement.style.setProperty('--profile', params.get('color') || '#e2700c');

  const $ = (id) => document.getElementById(id);
  const tabsEl = $('tabs');
  const address = $('address');
  const omni = $('omni');
  const statusEl = $('status');
  const summaryBtn = $('summary');
  const shield = $('shield');
  const actions = $('actions');
  if (params.get('partition')) actions.setAttribute('partition', params.get('partition'));

  const ICONS = {
    lock: '<svg viewBox="0 0 20 20"><rect x="4.5" y="8.5" width="11" height="8" rx="2"/><path d="M7 8.5V6.5a3 3 0 0 1 6 0v2"/></svg>',
    warn: '<svg viewBox="0 0 20 20"><path d="M10 3 2.5 16.5h15z"/><path d="M10 8v4M10 14.5v.1"/></svg>',
    search: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg>',
    spark: '<svg viewBox="0 0 20 20"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6z"/></svg>',
    lantern: '<svg viewBox="0 0 20 20"><path d="M7.5 3h5M7 5h6l-.6 10.5a1 1 0 0 1-1 .9H8.6a1 1 0 0 1-1-.9z"/><path d="M10 8c1.2 1.3 1.6 2.2 1.6 3a1.6 1.6 0 0 1-3.2 0c0-.8.4-1.7 1.6-3z"/></svg>',
    gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>',
    danger: '<svg viewBox="0 0 20 20"><path d="M10 3 2.5 16.5h15z"/><path d="M10 8v4M10 14.5v.1"/></svg>',
    globe: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13"/></svg>',
    audio: '<svg class="audio" viewBox="0 0 20 20"><path d="M4 8v4h3l4 3V5L7 8z"/><path d="M14 7.5a3.5 3.5 0 0 1 0 5"/></svg>',
    muted: '<svg class="audio" viewBox="0 0 20 20"><path d="M4 8v4h3l4 3V5L7 8z"/><path d="m13.5 8 4 4M17.5 8l-4 4"/></svg>',
    library: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.6"/></svg>',
    close: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  };

  let state = { tabs: [], activeId: null, settings: {}, blockedTotal: 0, profile: {}, downloads: {} };
  let editing = false;
  let firstRender = true;
  let extCount = -1;

  function parse(url) { try { return new URL(url); } catch { return null; } }
  function displayFor(url) {
    const u = parse(url);
    if (!u) return { text: url || '', kind: 'globe' };
    if (u.protocol === 'lantern:') {
      if (u.pathname === '/search.html' || u.pathname === '/summary.html') return { text: u.searchParams.get('q') || '', kind: u.searchParams.get('summary') ? 'spark' : 'search' };
      if (u.pathname === '/settings.html') return { text: 'lantern://settings', kind: 'gear' };
      if (u.pathname === '/library.html') return { text: 'lantern://' + (u.hash.slice(1).split('/')[0] || 'history'), kind: 'library' };
      if (u.pathname === '/warning.html') {
        const type = u.searchParams.get('type');
        return { text: u.searchParams.get('url') || '', kind: type === 'crash' ? 'globe' : 'danger' };
      }
      return { text: '', kind: 'lantern' };
    }
    const engines = [/(^|\.)duckduckgo\.com$/, /(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /^search\.brave\.com$/, /(^|\.)startpage\.com$/, /(^|\.)ecosia\.org$/];
    if (engines.some((re) => re.test(u.hostname)) && /\/(search|do\/search)?$|^\/$/.test(u.pathname) && u.searchParams.get('q')) {
      return { text: u.searchParams.get('q'), kind: 'search' };
    }
    if (u.protocol === 'https:') return { text: (u.host + u.pathname + u.search + u.hash).replace(/\/$/, ''), kind: 'lock' };
    if (u.protocol === 'http:') return { text: u.href, kind: 'warn' };
    return { text: u.href, kind: 'globe' };
  }
  function active() { return state.tabs.find((x) => x.id === state.activeId); }

  function renderToolbar() {
    const t = active();
    const p = state.profile || {};
    document.documentElement.style.setProperty('--profile', p.color || '#e2700c');
    $('initial').textContent = (p.name || 'P').trim().charAt(0).toUpperCase();
    $('profile').title = `${p.name || 'Profile'}${p.count > 1 ? ' · switch profile' : ''}`;
    $('home').hidden = state.settings.showHomeButton === false;
    summaryBtn.hidden = state.settings.toolbarSummary === false;
    if (window.LanternTheme) {
      window.LanternTheme.apply(state.settings.themeColor, state.palette);
      const theme = state.settings.themeColor && state.settings.themeColor !== 'ember' ? window.LanternTheme.swatch(state.settings.themeColor) : '';
      if (theme) document.documentElement.style.setProperty('--tint', theme); else document.documentElement.style.removeProperty('--tint');
    }
    actions.hidden = !state.extensions;
    if (state.extensionCount !== extCount) {
      // A newly installed or removed extension: ask the toolbar to refetch its buttons.
      extCount = state.extensionCount;
      if (typeof actions.fetchState === 'function') actions.fetchState();
    }

    // AI button: top right, shows which service answers. The arrow switches service or adds keys.
    const ai = state.ai || {};
    $('ai').hidden = state.settings.showAiButton === false;
    $('ai-name').textContent = ai.name || 'AI';
    $('ai-open').title = ai.name ? `Ask ${ai.name} (${navigator.platform.startsWith('Mac') ? '⇧⌘A' : 'Ctrl+Shift+A'})` : 'AI assistant: add an API key';
    $('ai-open').setAttribute('aria-pressed', String(!!(state.panel && state.panel.open && state.panel.mode === 'ai')));
    $('ai').classList.toggle('empty', !ai.active);
    renderBookmarksBar();

    const dl = state.downloads || {};
    const dlBtn = $('downloads');
    const wasHidden = dlBtn.hidden;
    dlBtn.hidden = !dl.count;
    dlBtn.classList.toggle('active', !!dl.active);
    dlBtn.style.setProperty('--p', dl.progress == null ? 0.15 : dl.progress);
    if (wasHidden && !dlBtn.hidden) { dlBtn.classList.remove('pulse'); void dlBtn.offsetWidth; dlBtn.classList.add('pulse'); }

    if (!t) return;
    const web = /^https?:/.test(t.url);
    const star = $('star');
    star.hidden = !web;
    star.setAttribute('aria-pressed', String(!!t.bookmarked));
    star.title = t.bookmarked ? 'Remove bookmark' : 'Bookmark this tab';
    const zoom = $('zoom');
    const dz = state.settings.defaultZoom || 100;
    zoom.hidden = !web || !t.zoom || t.zoom === dz;
    zoom.textContent = `${t.zoom}%`;
    zoom.title = `Zoom ${t.zoom}% · click to reset to ${dz}%`;
    const d = displayFor(t.url);
    if (t.certError && d.kind === 'lock') d.kind = 'warn';
    statusEl.innerHTML = ICONS[d.kind] || ICONS.globe;
    statusEl.className = 'status' + (d.kind === 'warn' || d.kind === 'danger' ? ' warn' : '');
    statusEl.title = d.kind === 'danger' ? 'Lantern stopped this page because it isn\'t safe' : d.kind === 'warn' ? (t.certError ? 'Not secure: you chose to continue despite an invalid certificate' : 'Not secure: this page is not using HTTPS') : d.kind === 'lock' ? 'Connection is secure' : '';
    if (!editing) address.value = d.text;
    address.placeholder = `Search ${state.settings.engineName || 'Lantern'} or type a URL`;
    const blocked = t.blocked || 0;
    shield.hidden = state.settings.toolbarShield === false || !(blocked > 0 && /^https?:/.test(t.url));
    $('blocked').textContent = blocked > 999 ? '999+' : String(blocked);
    shield.title = `${blocked} tracker${blocked === 1 ? '' : 's'} blocked on this page · ${state.blockedTotal} this session`;
    summaryBtn.setAttribute('aria-pressed', String(!!state.settings.summaryMode));
    $('back').disabled = !t.canBack;
    $('forward').disabled = !t.canForward;
    $('reload').classList.toggle('loading', !!t.loading);
    $('reload').title = t.loading ? 'Stop' : 'Reload';
  }

  function titleFor(t) {
    const u = parse(t.url);
    if (u && u.protocol === 'lantern:') {
      if (u.pathname === '/search.html' || u.pathname === '/summary.html') return u.searchParams.get('q') || 'Lantern Search';
      if (u.pathname === '/settings.html') return 'Settings';
      if (u.pathname === '/library.html') return ({ bookmarks: 'Bookmarks', downloads: 'Downloads' })[u.hash.slice(1).split('/')[0]] || 'History';
      if (u.pathname === '/warning.html') {
        const type = u.searchParams.get('type');
        return type === 'crash' ? 'Page crashed' : type === 'cert' ? 'Privacy error' : 'Dangerous site blocked';
      }
      return 'New Tab';
    }
    return t.title || t.url || 'New Tab';
  }

  function renderTabs() {
    const existing = new Map([...tabsEl.children].map((el) => [Number(el.dataset.id), el]));
    const narrow = state.tabs.length > 0 && tabsEl.clientWidth / state.tabs.length < 96;
    state.tabs.forEach((t, i) => {
      let el = existing.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tab' + (firstRender ? '' : ' enter');
        el.dataset.id = t.id;
        el.setAttribute('role', 'tab');
        el.draggable = true;
        el.innerHTML = '<span class="flare"></span><span class="icon"></span><span class="title"></span><span class="audio-slot"></span><button class="x" aria-label="Close tab">' + ICONS.close + '</button>';
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
        el.addEventListener('mousedown', (e) => {
          if (e.button === 1) { e.preventDefault(); api.send({ type: 'close-tab', id: t.id }); return; }
          if (!e.target.closest('.x')) api.send({ type: 'activate', id: t.id });
        });
        el.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); api.send({ type: 'close-tab', id: t.id }); });
        el.querySelector('.audio-slot').addEventListener('mousedown', (e) => { if (e.button === 0 && el.querySelector('.audio-slot').firstChild) { e.stopPropagation(); api.send({ type: 'mute', id: Number(el.dataset.id) }); } });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); api.send({ type: 'tab-menu', id: Number(el.dataset.id), x: e.clientX, y: e.clientY }); });
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/lantern-tab', String(t.id)); });
        el.addEventListener('dragover', (e) => e.preventDefault());
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          const id = Number(e.dataTransfer.getData('text/lantern-tab'));
          const to = state.tabs.findIndex((x) => x.id === Number(el.dataset.id));
          if (id && to >= 0) api.send({ type: 'move', id, to });
        });
      }
      existing.delete(t.id);
      if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);
      el.classList.toggle('active', t.id === state.activeId);
      el.classList.toggle('narrow', narrow);
      el.classList.toggle('sleeping', !!t.sleeping);
      el.classList.toggle('pinned', !!t.pinned);
      el.setAttribute('aria-selected', String(t.id === state.activeId));
      const title = titleFor(t);
      el.querySelector('.title').textContent = title;
      el.title = t.sleeping ? `${title} (sleeping to save memory)` : title;
      const slot = el.querySelector('.audio-slot');
      slot.innerHTML = t.muted ? ICONS.muted : t.audible ? ICONS.audio : '';
      slot.title = t.muted ? 'Unmute this tab' : t.audible ? 'Mute this tab' : '';
      const icon = el.querySelector('.icon');
      const kind = displayFor(t.url).kind;
      const key = t.loading ? 'spin' : t.favicon ? 'img:' + t.favicon : 'k:' + kind;
      if (icon.dataset.key !== key) {
        icon.dataset.key = key;
        if (t.loading) icon.innerHTML = '<span class="spin"></span>';
        else if (t.favicon) {
          icon.innerHTML = '';
          const img = document.createElement('img');
          img.src = t.favicon;
          img.alt = '';
          img.onerror = () => { icon.innerHTML = ICONS.globe; };
          icon.appendChild(img);
        } else {
          icon.innerHTML = ['spark', 'lantern', 'gear', 'search', 'danger', 'library'].includes(kind) ? ICONS[kind] : ICONS.globe;
          icon.classList.toggle('danger', kind === 'danger');
        }
      }
    });
    for (const el of existing.values()) el.remove();
    firstRender = false;
  }

  // ---------- events ----------
  api.onState((s) => {
    // Switching tabs abandons whatever was being typed, like Chrome.
    if (state.activeId !== s.activeId && editing) { hideSugg(); editing = false; omni.classList.remove('focus'); if (document.activeElement === address) address.blur(); }
    state = s; renderTabs(); renderToolbar();
  });
  api.onFocusOmnibox(() => { closeFind(); address.focus(); address.select(); });
  api.onFullscreen((on) => document.body.classList.toggle('fullscreen', on));

  // ---------- suggestions (as you type) ----------
  const sugg = { items: [], sel: -1, typed: '', seq: 0, open: false, timer: 0 };
  function showSugg() {
    if (!sugg.items.length || !editing) { hideSugg(); return; }
    const r = omni.getBoundingClientRect();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    sugg.open = true;
    omni.classList.add('dropped');
    api.send({ type: 'suggest-show', items: sugg.items, selected: sugg.sel, query: sugg.typed, rect: { x: r.left, width: r.width, bottom: r.bottom, accent } });
  }
  function hideSugg() {
    clearTimeout(sugg.timer);
    sugg.seq++;
    if (sugg.open) api.send({ type: 'suggest-hide' });
    sugg.open = false; sugg.items = []; sugg.sel = -1;
    omni.classList.remove('dropped');
  }
  async function querySugg(text) {
    const seq = ++sugg.seq;
    sugg.typed = text;
    clearTimeout(sugg.timer);
    try {
      const local = await api.suggest(text, false); // instant: typed text, tabs, history, shortcuts, recent searches
      if (seq !== sugg.seq || !editing) return;
      sugg.items = local; sugg.sel = -1; showSugg();
      applyInline(text, local);
      if (!text.trim()) return;
      sugg.timer = setTimeout(async () => {
        const full = await api.suggest(text, true); // then suggestions from the search provider
        if (seq !== sugg.seq || !editing) return;
        const keep = sugg.sel >= 0 ? sugg.items[sugg.sel] : null;
        sugg.items = full;
        sugg.sel = keep ? full.findIndex((x) => x.type === keep.type && x.text === keep.text) : -1;
        showSugg();
      }, 90);
    } catch {}
  }
  // Inline completion, like Chrome: typing "wik" fills in "ipedia.org" selected, so Enter goes
  // there and any key you type replaces it. Only when typing forward at the end of the box.
  let lastInput = '';
  function applyInline(typed, items) {
    if (state.settings.inlineAutocomplete === false || lastInput !== 'insertText') return;
    if (address.value !== typed || address.selectionStart !== typed.length) return;
    const item = items.find((x) => x.inline);
    if (!item || !typed.trim() || /\s/.test(typed)) return;
    address.value = typed + item.inline;
    address.setSelectionRange(typed.length, address.value.length);
  }
  function moveSel(dir) {
    if (!sugg.items.length) return;
    const n = sugg.items.length;
    sugg.sel = sugg.sel + dir < -1 ? n - 1 : sugg.sel + dir >= n ? -1 : sugg.sel + dir;
    const item = sugg.items[sugg.sel];
    address.value = item ? (item.type === 'url' ? (item.url || item.text) : item.type === 'tab' ? sugg.typed : item.text) : sugg.typed;
    showSugg();
  }
  api.onOmniboxDone(() => { hideSugg(); editing = false; address.blur(); renderToolbar(); });
  api.onSuggestRefresh(() => { if (editing) querySugg(address.value); });

  address.addEventListener('focus', () => {
    editing = true;
    omni.classList.add('focus');
    const t = active();
    const u = t && parse(t.url);
    const d = t && displayFor(t.url);
    if (u && /^https?:$/.test(u.protocol) && d.kind !== 'search') address.value = t.url;
    setTimeout(() => address.select(), 0);
  });
  // Clicking into an empty box offers recent searches (but not when a new tab focuses it for you).
  address.addEventListener('click', () => { if (editing && !address.value.trim() && !sugg.open) querySugg(''); });

  address.addEventListener('input', (e) => {
    lastInput = e.inputType || '';
    if (sugg.typed && address.value === sugg.typed.slice(0, -1) && lastInput === 'deleteContentBackward') lastInput = 'delete';
    querySugg(address.value);
  });
  address.addEventListener('blur', () => {
    // A click in the suggestion popup arrives just after this blur; give it a moment.
    setTimeout(() => { if (document.activeElement !== address) { hideSugg(); editing = false; omni.classList.remove('focus'); renderToolbar(); } }, 180);
  });
  address.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sugg.open) { querySugg(address.value); return; }
      e.preventDefault();
      moveSel(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Escape') {
      if (sugg.open) { e.preventDefault(); address.value = sugg.typed; hideSugg(); return; }
      address.blur();
    }
    if (e.key === 'Delete' && e.shiftKey && sugg.sel >= 0 && sugg.items[sugg.sel].type === 'recent') {
      e.preventDefault();
      api.send({ type: 'suggest-remove', index: sugg.sel });
      address.value = sugg.typed;
      querySugg(sugg.typed);
      return;
    }
    if (e.key === 'Enter' && e.altKey) {
      // Alt/Option+Enter: summarize this search instead.
      e.preventDefault();
      const text = address.value.trim();
      hideSugg();
      if (text) api.send({ type: 'navigate', text, summary: true });
      address.blur();
    }
  });
  omni.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = address.value.trim();
    if (sugg.open && sugg.sel >= 0) {
      const index = sugg.sel;
      sugg.open = false; // main hides the popup as part of the pick
      api.send({ type: 'suggest-pick', index });
      hideSugg();
    } else {
      hideSugg();
      if (!text) return;
      api.send({ type: 'navigate', text });
    }
    editing = false;
    address.blur();
  });

  summaryBtn.addEventListener('click', () => {
    const on = !state.settings.summaryMode;
    api.send({ type: 'summary-mode', on });
    const t = active();
    const d = t && displayFor(t.url);
    const text = editing ? address.value.trim() : d && (d.kind === 'search' || d.kind === 'spark') ? d.text : '';
    if (text && on) api.send({ type: 'navigate', text, summary: true });
  });

  // ---------- find on page ----------
  const findbar = $('findbar');
  const findtext = $('findtext');
  function openFind() {
    document.body.classList.add('finding');
    findbar.hidden = false;
    findtext.focus();
    findtext.select();
  }
  function closeFind() {
    if (findbar.hidden) return;
    findbar.hidden = true;
    $('findcount').textContent = '';
    document.body.classList.remove('finding');
    api.send({ type: 'find-close' });
  }
  findtext.addEventListener('input', () => api.send({ type: 'find', text: findtext.value }));
  findbar.addEventListener('submit', (e) => { e.preventDefault(); api.send({ type: 'find', text: findtext.value, next: true }); });
  $('findnext').addEventListener('click', () => api.send({ type: 'find', text: findtext.value, next: true }));
  $('findprev').addEventListener('click', () => api.send({ type: 'find', text: findtext.value, next: true, forward: false }));
  $('findclose').addEventListener('click', closeFind);
  findtext.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFind(); });
  api.onFind(openFind);
  api.onFindResult((r) => { $('findcount').textContent = findtext.value ? `${r.active}/${r.total}` : ''; });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
  });

  // ---------- buttons ----------
  $('newtab').addEventListener('click', () => api.send({ type: 'new-tab' }));
  $('back').addEventListener('click', () => api.send({ type: 'back' }));
  $('forward').addEventListener('click', () => api.send({ type: 'forward' }));
  $('reload').addEventListener('click', () => { const t = active(); api.send({ type: t && t.loading ? 'stop' : 'reload' }); });
  $('home').addEventListener('click', () => api.send({ type: 'home' }));
  $('star').addEventListener('click', () => api.send({ type: 'bookmark' }));
  $('zoom').addEventListener('click', () => api.send({ type: 'zoom-reset' }));
  $('ai-open').addEventListener('click', () => api.send({ type: 'panel', mode: 'ai' }));
  $('ai-pick').addEventListener('click', (e) => api.send({ type: 'ai-menu', ...below(e.currentTarget.parentElement, 250) }));
  $('bm-more').addEventListener('click', () => api.send({ type: 'bookmarks-more' }));
  const below = (el, width) => { const r = el.getBoundingClientRect(); return { x: Math.max(4, r.right - width), y: r.bottom + 4 }; };
  $('menu').addEventListener('click', (e) => api.send({ type: 'menu', ...below(e.currentTarget, 230) }));
  $('profile').addEventListener('click', (e) => api.send({ type: 'profile-menu', ...below(e.currentTarget, 220) }));
  $('downloads').addEventListener('click', (e) => api.send({ type: 'downloads-menu', ...below(e.currentTarget, 260) }));
  $('strip').addEventListener('dblclick', (e) => {
    if (e.target.id === 'strip' || e.target.classList.contains('drag-fill')) api.send({ type: 'new-tab' });
  });
  window.addEventListener('resize', () => { renderTabs(); renderBookmarksBar(true); });

  // ---------- bookmarks bar ----------
  let barKey = '';
  function renderBookmarksBar(force) {
    const on = !!(state.settings.bookmarksBar);
    document.body.classList.toggle('with-bar', on);
    $('bmbar').hidden = !on;
    if (!on) { barKey = ''; return; }
    const list = state.bookmarks || [];
    const key = JSON.stringify(list) + window.innerWidth;
    if (key === barKey && !force) return;
    barKey = key;
    const box = $('bm-items');
    box.textContent = '';
    if (!list.length) {
      const hint = document.createElement('span');
      hint.className = 'bm-empty';
      hint.textContent = 'For quick access, bookmark pages with the star in the address bar.';
      box.append(hint);
      $('bm-more').hidden = true;
      return;
    }
    for (const b of list) {
      const btn = document.createElement('button');
      btn.className = 'bm';
      btn.type = 'button';
      btn.title = `${b.title}\n${b.url}`;
      const ic = document.createElement('span');
      ic.className = 'bm-ic';
      if (b.favicon) {
        const img = document.createElement('img');
        img.src = b.favicon; img.alt = '';
        img.onerror = () => { ic.innerHTML = ICONS.globe; };
        ic.append(img);
      } else ic.innerHTML = ICONS.globe;
      const label = document.createElement('span');
      label.className = 'bm-label';
      label.textContent = b.title || b.url;
      btn.append(ic, label);
      btn.addEventListener('mouseup', (e) => {
        if (e.button === 1 || (e.button === 0 && (e.metaKey || e.ctrlKey))) api.send({ type: 'bookmark-open', id: b.id, newTab: true, foreground: e.shiftKey });
        else if (e.button === 0) api.send({ type: 'bookmark-open', id: b.id });
      });
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); api.send({ type: 'bookmark-menu', id: b.id, x: e.clientX, y: e.clientY }); });
      box.append(btn);
    }
    // Bookmarks that don't fit go behind the » button, which opens the bookmark manager.
    requestAnimationFrame(() => {
      const limit = box.getBoundingClientRect().right;
      let hidden = 0;
      for (const el of box.children) { const off = el.getBoundingClientRect().right > limit + 1; el.style.visibility = off ? 'hidden' : ''; if (off) hidden++; }
      $('bm-more').hidden = hidden === 0;
    });
  }

  api.send({ type: 'ready' });
})();
