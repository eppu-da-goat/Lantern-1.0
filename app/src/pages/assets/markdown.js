'use strict';
// A small, safe Markdown renderer for AI answers. It builds DOM nodes directly (never innerHTML),
// so nothing an AI writes can run as code. Links open only if they're http(s).
(() => {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Inline: `code`, **bold**, *italic* / _italic_, ~~strike~~ and [links](https://…).
  const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  function inline(parent, text) {
    let last = 0;
    const re = new RegExp(INLINE.source, 'g'); // its own cursor: inline() calls itself for nested styles
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[2] !== undefined) parent.append(el('code', '', m[2]));
      else if (m[3] !== undefined || m[4] !== undefined) { const b = el('strong'); inline(b, m[3] || m[4]); parent.append(b); }
      else if (m[5] !== undefined) { const s = el('s'); inline(s, m[5]); parent.append(s); }
      else if (m[6] !== undefined || m[7] !== undefined) { const i = el('em'); inline(i, m[6] || m[7]); parent.append(i); }
      else if (m[8] !== undefined) { const a = link(m[9]); inline(a, m[8]); parent.append(a); }
      else if (m[10] !== undefined) { const a = link(m[10]); a.textContent = m[10]; parent.append(a); }
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }
  function link(href) {
    const a = el('a');
    try { const u = new URL(href); if (u.protocol === 'https:' || u.protocol === 'http:') a.href = u.href; } catch {}
    a.target = '_blank';
    a.rel = 'noreferrer';
    return a;
  }

  function render(src) {
    const frag = document.createDocumentFragment();
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    let para = [];
    const flush = () => {
      if (!para.length) return;
      const p = el('p');
      para.forEach((line, k) => { if (k) p.append(el('br')); inline(p, line); });
      frag.append(p);
      para = [];
    };
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
      if (fence) {
        flush();
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++; // closing fence (or end of a still-streaming answer)
        const pre = el('pre', 'code');
        if (fence[2]) pre.dataset.lang = fence[2];
        const c = el('code', '', code.join('\n'));
        const copy = el('button', 'copy-code', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', () => { window.dispatchEvent(new CustomEvent('lantern-copy', { detail: c.textContent })); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); });
        pre.append(copy, c);
        frag.append(pre);
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flush();
        const level = Math.min(4, h[1].length + 1);
        const n = el('h' + level);
        inline(n, h[2].replace(/\s+#+\s*$/, ''));
        frag.append(n);
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); frag.append(el('hr')); i++; continue; }
      if (/^\s*>\s?/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        const bq = el('blockquote');
        bq.append(render(q.join('\n')));
        frag.append(bq);
        continue;
      }
      const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        flush();
        const ordered = /\d/.test(li[2]);
        const list = el(ordered ? 'ol' : 'ul');
        if (ordered && parseInt(li[2], 10) !== 1) list.start = parseInt(li[2], 10);
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m && /\d/.test(m[2]) === ordered && m[1].length < 2) {
            const item = el('li');
            const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
            if (task) { item.className = 'task' + (task[1] !== ' ' ? ' done' : ''); inline(item, task[2]); } else inline(item, m[3]);
            list.append(item);
            i++;
          } else if (m && m[1].length < 2) {
            break; // a top-level list of the other kind starts its own list
          } else if (m || (lines[i].trim() && /^\s{2,}/.test(lines[i]))) {
            // nested item or continuation: attach to the last item
            const last = list.lastElementChild || list.appendChild(el('li'));
            const sub = m ? (() => { const x = el('div', 'sub-item'); inline(x, (/\d/.test(m[2]) ? m[2] + ' ' : '• ') + m[3]); return x; })() : (() => { const x = el('div'); inline(x, lines[i].trim()); return x; })();
            last.append(sub);
            i++;
          } else break;
        }
        frag.append(list);
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        const table = el('table');
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
        const head = el('tr');
        cells(line).forEach((c) => { const th = el('th'); inline(th, c); head.append(th); });
        table.append(head);
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          const tr = el('tr');
          cells(lines[i]).forEach((c) => { const td = el('td'); inline(td, c); tr.append(td); });
          table.append(tr);
          i++;
        }
        const wrap = el('div', 'table-wrap');
        wrap.append(table);
        frag.append(wrap);
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line);
      i++;
    }
    flush();
    return frag;
  }

  window.LanternMarkdown = { render };
})();
