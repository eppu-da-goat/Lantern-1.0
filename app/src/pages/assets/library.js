'use strict';
// Library: History, Bookmarks and Downloads for this profile. Everything stays on this device.
(() => {
  const api = window.lantern;
  const $ = (id) => document.getElementById(id);
  const isMac = navigator.platform.startsWith('Mac');
  let section = 'history';
  let info = null;

  const ICON = {
    globe: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13"/></svg>',
    x: '<svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
    edit: '<svg viewBox="0 0 20 20"><path d="M12.8 3.6l3.6 3.6-9 9H3.8v-3.6z"/></svg>',
    tab: '<svg viewBox="0 0 20 20"><path d="M11 4h5v5M16 4l-7 7M14 11.5V16H4V6h4.5"/></svg>',
    folder: '<svg viewBox="0 0 20 20"><path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2h6.2A1.5 1.5 0 0 1 17 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/></svg>',
    file: '<svg viewBox="0 0 20 20"><path d="M5.5 3h6l3.5 3.5V17h-9.5z"/><path d="M11.5 3v3.5H15"/></svg>',
    up: '<svg viewBox="0 0 20 20"><path d="M5 12.5 10 7.5l5 5"/></svg>',
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(icon, title, onClick) {
    const b = el('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ICON[icon];
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.hidden = false; t.textContent = msg;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function host(url) { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } }
  function favicon(url) {
    const s = el('span', 'fav');
    s.innerHTML = ICON.globe;
    return s;
  }

  // ---------- navigation ----------
  function route() {
    const [s, focus] = location.hash.slice(1).split('/');
    section = ['history', 'bookmarks', 'downloads'].includes(s) ? s : 'history';
    for (const sec of document.querySelectorAll('.lib-section')) sec.hidden = sec.id !== section;
    for (const a of document.querySelectorAll('.side a')) a.classList.toggle('current', a.dataset.s === section);
    const name = { history: 'History', bookmarks: 'Bookmarks', downloads: 'Downloads' }[section];
    $('heading').textContent = name;
    document.title = name;
    $('filter').placeholder = `Search ${name.toLowerCase()}`;
    $('filter').value = '';
    if (section === 'history') loadHistory(true);
    if (section === 'bookmarks') loadBookmarks(decodeURIComponent(focus || ''));
    if (section === 'downloads') loadDownloads();
  }
  window.addEventListener('hashchange', route);

  // ---------- history ----------
  let oldest = 0;
  let searchTimer;
  function dayLabel(ms) {
    const d = new Date(ms);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diff = Math.round((today - that) / 864e5);
    const date = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    return diff === 0 ? `Today · ${date}` : diff === 1 ? `Yesterday · ${date}` : date;
  }
  function historyEntry(h, withTime) {
    const li = el('li', 'entry');
    li.append(el('time', '', withTime ? new Date(h.last).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''), favicon(h.url));
    const a = el('a');
    a.href = h.url;
    a.append(el('span', 't', h.title || h.url), el('span', 'h', host(h.url)));
    a.title = `${h.title}\n${h.url}\nVisited ${h.visits} time${h.visits === 1 ? '' : 's'}`;
    li.append(a);
    const acts = el('div', 'acts');
    acts.append(
      button('tab', 'Open in new tab', () => window.open(h.url, '_blank')),
      button('x', 'Remove from history', async () => { await api.removeHistory([h.url]); li.remove(); toast('Removed from history'); }),
    );
    li.append(acts);
    return li;
  }
  async function loadHistory(reset) {
    const text = $('filter').value.trim();
    if (reset) { $('h-list').textContent = ''; oldest = 0; }
    const r = await api.history({ text, before: text ? 0 : oldest, limit: 150 });
    $('h-off').hidden = r.saving || r.private;
    $('h-private').hidden = !r.private;
    const list = $('h-list');
    if (text) {
      const ul = el('ul', 'card entries');
      r.items.forEach((h) => ul.append(historyEntry(h, false)));
      list.append(ul);
      $('h-more').hidden = true;
    } else {
      let lastDay = list.lastElementChild ? list.lastElementChild.dataset.day : '';
      let ul = list.lastElementChild ? list.lastElementChild.querySelector('ul') : null;
      for (const h of r.items) {
        const day = new Date(h.last).toDateString();
        if (day !== lastDay) {
          const box = el('div', 'day');
          box.dataset.day = day;
          box.append(el('h3', '', dayLabel(h.last)));
          ul = el('ul', 'card entries');
          box.append(ul);
          list.append(box);
          lastDay = day;
        }
        ul.append(historyEntry(h, true));
        oldest = h.last;
      }
      $('h-more').hidden = r.items.length < 150;
    }
    $('h-empty').hidden = list.querySelector('.entry') !== null;
    $('h-empty').textContent = text ? `No history matches “${text}”.` : 'No history yet. Pages you visit will show up here.';
  }
  $('h-more').addEventListener('click', () => loadHistory(false));
  $('clear-history').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const range = Number($('clear-range').value);
    const label = $('clear-range').selectedOptions[0].textContent.toLowerCase();
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = `Clear ${label}?`; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Clear history'; }, 3500); return; }
    b.dataset.confirm = ''; b.textContent = 'Clear history';
    await api.clearHistory(range);
    toast('History cleared');
    loadHistory(true);
  });

  // ---------- bookmarks ----------
  let editing = null;
  let bookmarks = [];
  function renderBookmarks(focusId) {
    const q = $('filter').value.trim().toLowerCase();
    const ul = $('b-list');
    ul.className = 'card entries bm';
    ul.textContent = '';
    const shown = bookmarks.filter((b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
    shown.forEach((b) => {
      const li = el('li', 'entry' + (b.id === focusId ? ' focus' : ''));
      li.draggable = !q;
      li.dataset.id = b.id;
      const fav = el('span', 'fav');
      if (b.favicon) { const img = el('img'); img.src = b.favicon; img.alt = ''; img.onerror = () => { fav.innerHTML = ICON.globe; }; fav.append(img); } else fav.innerHTML = ICON.globe;
      const a = el('a');
      a.href = b.url;
      a.append(el('span', 't', b.title || b.url), el('span', 'h', host(b.url)));
      a.title = `${b.title}\n${b.url}`;
      const acts = el('div', 'acts');
      acts.append(
        button('tab', 'Open in new tab', () => window.open(b.url, '_blank')),
        button('edit', 'Edit', () => openForm(b)),
        button('x', 'Delete', async () => { await api.removeBookmark(b.id); toast('Bookmark deleted'); loadBookmarks(); }),
      );
      li.append(fav, a, acts);
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/lantern-bm', b.id); li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-before'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        li.classList.remove('drop-before');
        const id = e.dataTransfer.getData('text/lantern-bm');
        if (!id || id === b.id) return;
        const to = bookmarks.findIndex((x) => x.id === b.id);
        await api.moveBookmark(id, to);
        loadBookmarks();
      });
      ul.append(li);
      if (b.id === focusId) setTimeout(() => li.scrollIntoView({ block: 'center' }), 50);
    });
    $('b-empty').hidden = shown.length > 0 || !!q;
  }
  async function loadBookmarks(focusId) {
    bookmarks = await api.bookmarks();
    if (!info) info = await api.info();
    $('bar-toggle').checked = !!info.settings.bookmarksBar;
    renderBookmarks(focusId);
    if (focusId) { const b = bookmarks.find((x) => x.id === focusId); if (b) openForm(b); }
  }
  function openForm(b) {
    editing = b || null;
    $('bm-form').hidden = false;
    $('bm-title').value = b ? b.title : '';
    $('bm-url').value = b ? b.url : '';
    $('bm-error').hidden = true;
    $('bm-title').focus();
  }
  $('add-bm').addEventListener('click', () => openForm(null));
  $('bm-cancel').addEventListener('click', () => { $('bm-form').hidden = true; editing = null; });
  $('bm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = $('bm-url').value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const title = $('bm-title').value.trim() || url;
    try {
      if (editing) await api.updateBookmark(editing.id, { title, url });
      else await api.addBookmark({ title, url });
      $('bm-form').hidden = true;
      toast(editing ? 'Bookmark saved' : 'Bookmark added');
      editing = null;
      loadBookmarks();
    } catch (err) {
      $('bm-error').hidden = false;
      $('bm-error').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
  });
  $('bar-toggle').addEventListener('change', async () => {
    info.settings = await api.setSetting('bookmarksBar', $('bar-toggle').checked);
    toast($('bar-toggle').checked ? 'Bookmarks bar shown' : 'Bookmarks bar hidden');
  });
  $('kbd-d').textContent = isMac ? '⌘D' : 'Ctrl+D';

  // ---------- downloads ----------
  function size(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
  }
  async function loadDownloads() {
    const q = $('filter').value.trim().toLowerCase();
    const list = (await api.downloads()).filter((d) => !q || d.name.toLowerCase().includes(q));
    const ul = $('d-list');
    ul.className = 'card entries dl';
    ul.textContent = '';
    for (const d of list) {
      const li = el('li', 'entry' + (d.state === 'completed' && !d.exists ? ' gone' : ''));
      const ic = el('span', 'fav');
      ic.innerHTML = ICON.file;
      const stack = el('div', 'stack');
      const name = el('span', 't', d.name);
      const status = d.state === 'progressing' ? `${size(d.received)} of ${size(d.total) || '?'}`
        : d.state === 'completed' ? (d.exists ? size(d.total || d.received) : 'Deleted or moved')
        : d.state === 'cancelled' ? 'Cancelled' : 'Failed';
      stack.append(name, el('span', 'meta', status));
      if (d.state === 'progressing' && d.total) { const bar = el('div', 'bar'); const i = el('i'); i.style.width = `${Math.round((d.received / d.total) * 100)}%`; bar.append(i); stack.append(bar); }
      const acts = el('div', 'acts');
      if (d.state === 'completed' && d.exists) {
        acts.append(button('file', 'Open', () => api.downloadAction(d.id, 'open')), button('folder', isMac ? 'Show in Finder' : 'Show in folder', () => api.downloadAction(d.id, 'show')));
      }
      acts.append(button('x', 'Remove from list', async () => { await api.downloadAction(d.id, 'remove'); loadDownloads(); }));
      li.append(ic, stack, acts);
      ul.append(li);
    }
    $('d-empty').hidden = list.length > 0;
  }
  $('clear-dl').addEventListener('click', async () => { await api.clearDownloads(); loadDownloads(); });
  setInterval(() => { if (section === 'downloads' && !document.hidden) loadDownloads(); }, 1500);

  // ---------- search box ----------
  $('filter').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (section === 'history') loadHistory(true);
      else if (section === 'bookmarks') renderBookmarks();
      else loadDownloads();
    }, 120);
  });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('filter').focus(); }
  });

  api.info().then((i) => { info = i; }).catch(() => {});
  route();
})();
