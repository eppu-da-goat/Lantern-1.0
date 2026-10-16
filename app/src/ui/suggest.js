'use strict';
(() => {
  const api = window.lanternSuggest;
  const list = document.getElementById('list');
  const ICON = {
    search: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg>',
    recent: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.6"/></svg>',
    url: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13"/></svg>',
    tab: '<svg viewBox="0 0 20 20"><rect x="3" y="4.5" width="14" height="11" rx="2"/><path d="M3 8h6V4.5"/></svg>',
    x: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
    history: '<svg viewBox="0 0 20 20"><path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3.5 3.5v3h3"/><path d="M10 6.5V10l2.5 1.6"/></svg>',
    bookmark: '<svg viewBox="0 0 20 20"><path d="m10 3 2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z"/></svg>',
    ai: '<svg viewBox="0 0 20 20"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6z"/></svg>',
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  // Like Chrome: what you typed stays regular, the rest of the suggestion is bold.
  function textWithCompletion(text, query) {
    const span = el('span', 'text');
    const q = query.trim().toLowerCase();
    if (q && text.toLowerCase().startsWith(q) && text.length > q.length) {
      span.append(el('span', 'typed', text.slice(0, q.length)), el('b', '', text.slice(q.length)));
    } else span.textContent = text;
    return span;
  }

  api.onRender(({ items, selected, query, dark, accent }) => {
    document.body.classList.toggle('dark', !!dark);
    if (accent) document.documentElement.style.setProperty('--accent', accent);
    list.textContent = '';
    if (!query && items.length && items.every((x) => x.type === 'recent')) list.append(el('li', 'head', 'Recent searches'));
    items.forEach((item, i) => {
      const row = el('li', 'row' + (i === selected ? ' sel' : ''));
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === selected));
      const ic = el('span', 'ic');
      ic.innerHTML = ICON[item.type] || ICON.search;
      row.append(ic);
      const plain = item.type === 'tab' || item.type === 'ai' || item.type === 'history' || item.type === 'bookmark' || (item.type === 'url' && item.sub);
      const t = plain ? el('span', 'text', item.text) : textWithCompletion(item.text, query || '');
      if (item.sub && item.type !== 'tab' && item.type !== 'ai') t.append(el('span', 'sub link', '— ' + item.sub));
      if (item.type === 'search' && item.typed) t.append(el('span', 'sub', '— Search'));
      row.append(t);
      if (item.type === 'tab') row.append(el('span', 'tag', 'Switch to this tab'));
      if (item.type === 'ai') { row.classList.add('ai'); row.append(el('span', 'tag', item.sub || 'Ask AI')); }
      if (item.type === 'recent') {
        const x = el('span', 'x');
        x.innerHTML = ICON.x;
        x.title = 'Remove from recent searches';
        x.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); api.remove(i); });
        row.append(x);
      }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); api.pick(i, e.altKey); });
      list.append(row);
    });
  });
})();
