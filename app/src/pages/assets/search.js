'use strict';
(() => {
  const api = window.lantern;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const query = (params.get('q') || '').trim();
  const forceSummary = params.get('summary') === '1';
  const ddg = (extra = '') => 'https://duckduckgo.com/?q=' + encodeURIComponent(query) + extra;
  const favicon = (host) => host ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico` : '';

  document.title = query ? `${query} · Lantern Search` : 'Lantern Search';
  $('q').value = query;
  $('t-all').href = location.href;
  $('t-images').href = ddg('&iax=images&ia=images');
  $('t-news').href = ddg('&iar=news&ia=news');
  $('t-videos').href = ddg('&iax=videos&ia=videos');
  $('t-maps').href = ddg('&iaxm=maps&ia=web');
  $('on-ddg').href = ddg();

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function go(text, summary) {
    const t = text.trim();
    if (!t) return;
    location.href = 'lantern://app/search.html?q=' + encodeURIComponent(t) + (summary ? '&summary=1' : '');
  }
  $('ask').addEventListener('submit', (e) => { e.preventDefault(); go($('q').value); });
  if (window.LanternSuggest) {
    window.LanternSuggest.attach({
      input: $('q'),
      anchor: $('ask'),
      onPick: (item, alt) => { if (item.type === 'url' && item.url) location.href = item.url; else go(item.text, alt); },
    });
  }
  $('clear').addEventListener('click', () => { $('q').value = ''; $('q').focus(); });
  $('retry').addEventListener('click', () => location.reload());

  // ---------- results ----------
  const seen = [];
  let next = null;
  let sources = [];
  const keyOf = (url) => url.replace(/[#?].*$/, '').replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, '');

  function pathCrumb(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean).slice(0, 3).map((p) => decodeURIComponent(p).replace(/[-_]+/g, ' ').replace(/\.\w+$/, ''));
      return [u.hostname.replace(/^www\./, ''), ...parts].join(' › ');
    } catch { return url; }
  }
  function siteName(host) {
    const base = host.replace(/^www\./, '').split('.');
    const name = base.length > 2 && base[0].length > 3 ? base[0] : base[base.length - 2] || host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function renderResults(list, append) {
    const ol = $('results');
    if (!append) ol.replaceChildren();
    const offset = ol.children.length;
    list.forEach((r, i) => {
      seen.push(keyOf(r.url));
      const li = el('li', 'result');
      li.style.setProperty('--i', append ? i : i + 2);
      li.dataset.url = r.url;
      const a = el('a');
      a.href = r.url;
      const host = el('span', 'host');
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = favicon(r.host);
      img.onerror = () => { img.style.visibility = 'hidden'; };
      const site = el('span', 'site');
      site.append(el('span', 'name', siteName(r.host)), el('span', 'path', pathCrumb(r.url)));
      host.append(img, site);
      a.append(host, el('span', 't', r.title));
      if (r.snippet) a.appendChild(el('span', 's', r.snippet));
      li.appendChild(a);
      ol.appendChild(li);
    });
    markSourceResults();
    return offset;
  }

  function markSourceResults() {
    if (!sources.length) return;
    const idx = new Map(sources.map((s, i) => [keyOf(s.url), i]));
    for (const li of $('results').children) {
      const i = idx.get(keyOf(li.dataset.url));
      const hostEl = li.querySelector('.host');
      if (i !== undefined && !hostEl.querySelector('.used')) hostEl.appendChild(el('span', 'used', `Source ${i + 1}`));
    }
  }

  function renderPanel(p) {
    if (!p) return;
    $('panel').hidden = false;
    $('panel-title').textContent = p.title;
    $('panel-text').textContent = p.text;
    if (p.image) { $('panel-img').src = p.image; $('panel-img').hidden = false; $('panel-img').onerror = () => { $('panel-img').hidden = true; }; }
    const dl = $('panel-facts');
    dl.replaceChildren();
    for (const f of p.facts || []) dl.append(el('dt', '', f.label), el('dd', '', f.value));
    if (p.url) { $('panel-link').href = p.url; $('panel-link').textContent = `Read more on ${p.source || 'the source'} →`; }
    else $('panel-link').hidden = true;
  }

  function renderRelated(list) {
    if (!list || !list.length) return;
    $('related-wrap').hidden = false;
    const box = $('related');
    box.replaceChildren();
    list.forEach((r) => { const a = el('a', '', r); a.href = 'lantern://app/search.html?q=' + encodeURIComponent(r); box.appendChild(a); });
  }

  function friendlyError(err) {
    const msg = String((err && err.message) || err || '');
    return /fetch|network|net::|ERR_|ENOTFOUND|ECONN|abort|timed? ?out|HTTP/i.test(msg)
      ? "DuckDuckGo couldn't be reached. Check your internet connection and try again."
      : 'Something went wrong while reading the results. Try again in a moment.';
  }

  async function runSearch() {
    try {
      const data = await api.search(query);
      $('res-loading').hidden = true;
      next = data.next;
      if (data.answer) { $('answer').hidden = false; $('answer').textContent = data.answer; }
      renderResults(data.results, false);
      renderPanel(data.panel);
      renderRelated(data.related);
      $('more').hidden = !next;
      if (!data.results.length) {
        $('results').appendChild(el('li', 'result', `No results for “${query}”. Try different words, or search DuckDuckGo directly.`));
      }
    } catch (err) {
      $('res-loading').hidden = true;
      $('error').hidden = false;
      $('error-msg').textContent = friendlyError(err);
    }
  }

  $('more').addEventListener('click', async () => {
    const btn = $('more');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const data = await api.search(query, next, seen);
      next = data.next;
      if (data.results.length) renderResults(data.results, true);
      btn.hidden = !next || !data.results.length;
    } catch {
      btn.hidden = true;
    } finally {
      btn.disabled = false;
      btn.textContent = 'More results';
    }
  });

  // ---------- summary ----------
  let summaryStarted = false;
  function citeLink(index) {
    const s = sources[index];
    const a = el('a', 'cite', String(index + 1));
    a.href = s ? s.url : '#';
    a.title = s ? `${s.site}: ${s.title}` : '';
    const lit = (on) => document.querySelector(`.src[data-i="${index}"]`)?.classList.toggle('lit', on);
    a.addEventListener('mouseenter', () => lit(true));
    a.addEventListener('mouseleave', () => lit(false));
    return a;
  }
  function streamWords(node, text) {
    // Words fade in one after another, like the answer is being written.
    node.replaceChildren();
    text.split(/(\s+)/).forEach((part, i) => {
      if (/^\s+$/.test(part)) { node.appendChild(document.createTextNode(part)); return; }
      const span = el('span', 'w', part);
      span.style.setProperty('--w', Math.floor(i / 2));
      node.appendChild(span);
    });
  }

  function renderSummary(data) {
    $('summary').classList.remove('loading');
    $('sum-loading').hidden = true;
    $('sum-step').textContent = `${data.sources.length} source${data.sources.length === 1 ? '' : 's'} · ${(data.tookMs / 1000).toFixed(1)}s`;
    sources = data.sources;
    if (!data.overview && !data.points.length) {
      $('sum-error').hidden = false;
      $('sum-error').textContent = 'There wasn’t enough readable text on the top pages to summarize. The results below are still worth a look.';
      return;
    }
    $('sum-body').hidden = false;
    // The knowledge panel already shows the reference definition; open with what the pages say instead.
    if (!$('panel').hidden && data.overviewSource && data.overviewSource.url && data.points.length) {
      const first = data.points.shift();
      data.overview = first.text;
      data.overviewSource = { index: first.source };
    }
    const ov = $('overview');
    streamWords(ov, data.overview);
    const os = data.overviewSource;
    if (os) {
      if (typeof os.index === 'number') ov.appendChild(citeLink(os.index));
      if (typeof os.also === 'number') ov.appendChild(citeLink(os.also));
      if (os.url) { const a = el('a', 'cite', os.title || 'source'); a.href = os.url; ov.appendChild(a); }
    }
    const ul = $('points');
    ul.replaceChildren();
    data.points.forEach((p, i) => {
      const li = el('li', i >= 3 ? 'extra' : '', p.text);
      li.style.setProperty('--i', i);
      li.appendChild(citeLink(p.source));
      ul.appendChild(li);
    });
    $('more-points').hidden = data.points.length <= 3;
    const row = $('sum-sources');
    row.replaceChildren();
    sources.forEach((s, i) => {
      const a = el('a', 'src');
      a.href = s.url;
      a.dataset.i = i;
      const img = el('img');
      img.alt = '';
      img.src = favicon(s.host);
      img.onerror = () => { img.style.visibility = 'hidden'; };
      a.append(img, el('span', 'n', String(i + 1)), el('span', '', s.site || s.host));
      row.appendChild(a);
    });
    markSourceResults();
  }
  $('more-points').addEventListener('click', () => {
    const s = $('summary');
    s.classList.toggle('expanded');
    $('more-points').firstChild.textContent = s.classList.contains('expanded') ? 'Show less ' : 'Show more ';
  });

  async function runSummary() {
    if (summaryStarted) return;
    summaryStarted = true;
    $('summarize').hidden = true;
    $('summary').hidden = false;
    $('summary').classList.add('loading');
    $('sum-step').textContent = 'Searching…';
    try {
      const data = await api.summarize(query);
      renderSummary(data);
    } catch (err) {
      $('summary').classList.remove('loading');
      $('sum-loading').hidden = true;
      $('sum-error').hidden = false;
      $('sum-error').textContent = friendlyError(err);
    }
  }
  $('summarize').addEventListener('click', runSummary);

  const toggle = $('sum-toggle');
  function setToggle(on) { toggle.setAttribute('aria-pressed', String(on)); }
  toggle.addEventListener('click', async () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    setToggle(on);
    try { await api.setSetting('summaryMode', on); } catch {}
    if (on) runSummary();
    else if (!summaryStarted) $('summarize').hidden = false;
  });

  // ---------- start ----------
  if (!query) { $('res-loading').hidden = true; $('q').focus(); return; }
  if (!api) { $('res-loading').hidden = true; $('error').hidden = false; $('error-msg').textContent = 'This page only works inside Lantern.'; return; }
  api.onProgress((step) => {
    const map = { Searching: 'Searching…', Picking: 'Picking the key points…' };
    const key = Object.keys(map).find((k) => step.startsWith(k));
    $('sum-step').textContent = key ? map[key] : step + '…';
  });
  runSearch();
  api.info().then((info) => {
    const on = forceSummary || !!info.settings.summaryMode;
    setToggle(!!info.settings.summaryMode || forceSummary);
    if (on) runSummary(); else $('summarize').hidden = false;
  }).catch(() => runSummary());
})();
