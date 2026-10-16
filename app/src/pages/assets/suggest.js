'use strict';
// Search suggestions for Lantern's own search boxes (new tab page and Lantern Search).
// Shows recent searches when the box is empty, then what you typed, your matching recent searches
// and suggestions from the search provider. Arrow keys move, Enter picks, Shift+Delete forgets.
(() => {
  const ICON = {
    search: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg>',
    recent: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.6"/></svg>',
    url: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13"/></svg>',
    arrow: '<svg viewBox="0 0 20 20"><path d="M6 14 14 6M7 6h7v7"/></svg>',
    x: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function attach({ input, anchor, onPick }) {
    if (!window.lantern || !window.lantern.suggest) return;
    const list = el('ul', 'sg-list');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    anchor.classList.add('sg-anchor');
    anchor.append(list);
    input.setAttribute('aria-autocomplete', 'list');
    const st = { items: [], sel: -1, typed: '', seq: 0, timer: 0 };

    function render() {
      list.textContent = '';
      if (!st.items.length || document.activeElement !== input) { list.hidden = true; anchor.classList.remove('sg-open'); return; }
      if (!st.typed.trim()) list.append(el('li', 'sg-head', 'Recent searches'));
      st.items.forEach((item, i) => {
        const row = el('li', 'sg-row' + (i === st.sel ? ' sel' : ''));
        row.setAttribute('role', 'option');
        const ic = el('span', 'sg-ic');
        ic.innerHTML = ICON[item.type] || ICON.search;
        const t = el('span', 'sg-text');
        const q = st.typed.trim().toLowerCase();
        if (q && item.type !== 'url' && item.text.toLowerCase().startsWith(q) && item.text.length > q.length) {
          t.append(el('span', '', item.text.slice(0, q.length)), el('b', '', item.text.slice(q.length)));
        } else t.textContent = item.text;
        if (item.sub) t.append(el('span', 'sg-sub', ' — ' + item.sub));
        row.append(ic, t);
        if (item.type === 'recent') {
          const x = el('button', 'sg-x');
          x.type = 'button';
          x.title = 'Remove from recent searches';
          x.innerHTML = ICON.x;
          x.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); forget(i); });
          row.append(x);
        } else if (item.type === 'search' && !item.typed) {
          // Like Chrome's "↖": copy the suggestion into the box to keep refining it.
          const fill = el('button', 'sg-fill');
          fill.type = 'button';
          fill.title = 'Use this text';
          fill.innerHTML = ICON.arrow;
          fill.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); input.value = item.text + ' '; query(input.value); });
          row.append(fill);
        }
        row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i, e.altKey); });
        list.append(row);
      });
      list.hidden = false;
      anchor.classList.add('sg-open');
    }
    function close() { st.seq++; clearTimeout(st.timer); st.items = []; st.sel = -1; render(); }
    async function query(text) {
      const seq = ++st.seq;
      st.typed = text;
      clearTimeout(st.timer);
      try {
        const local = await window.lantern.suggest(text, false);
        if (seq !== st.seq) return;
        st.items = local; st.sel = -1; render();
        if (!text.trim()) return;
        st.timer = setTimeout(async () => {
          const full = await window.lantern.suggest(text, true);
          if (seq !== st.seq) return;
          st.items = full; st.sel = -1; render();
        }, 90);
      } catch {}
    }
    function pick(i, alt) {
      const item = st.items[i];
      close();
      if (item) onPick(item, alt);
    }
    async function forget(i) {
      const item = st.items[i];
      if (!item) return;
      await window.lantern.forgetSearch(item.text).catch(() => {});
      query(st.typed);
    }

    input.addEventListener('focus', () => { if (!input.value.trim()) query(''); });
    input.addEventListener('input', () => query(input.value));
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
    window.addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 120)); // focus left the page
    input.addEventListener('keydown', (e) => {
      const n = st.items.length;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        st.sel = st.sel + d < -1 ? n - 1 : st.sel + d >= n ? -1 : st.sel + d;
        const item = st.items[st.sel];
        input.value = item ? (item.url && item.type === 'url' ? item.url : item.text) : st.typed;
        render();
      } else if (e.key === 'Escape' && n) {
        e.preventDefault();
        input.value = st.typed;
        close();
      } else if (e.key === 'Delete' && e.shiftKey && st.sel >= 0 && st.items[st.sel].type === 'recent') {
        e.preventDefault();
        input.value = st.typed;
        forget(st.sel);
      } else if (e.key === 'Enter' && st.sel >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(st.sel, e.altKey);
      } else if (e.key === 'Enter') {
        close();
      }
    });
  }

  window.LanternSuggest = { attach };
})();
