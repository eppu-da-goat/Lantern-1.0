'use strict';
// Lantern Search: Lantern's own search engine.
//
// It asks several independent sources at once and ranks the answers itself, in the Rust core
// (core.websearch.fuse): the same page found by several sources counts once and rises, your
// words are matched against titles and snippets, and no single site may fill the top.
//
// Sources:
//   local      pages you have visited, from Lantern's own full-text index on this computer
//   wikipedia  Wikipedia's search, in the language of your query
//   mwmbl      Mwmbl, a free, open, community-built web index
//   marginalia Marginalia's independent index of the small web (CC BY-NC-SA)
//   brave      Brave Search API, only with your own key
//   mojeek     Mojeek API (its own crawler), only with your own key
// No search goes to DuckDuckGo, Google or Bing. Nothing identifies you: no cookies are sent.

const core = require('./core');

const CACHE_MS = 3 * 60 * 1000;
const cache = new Map(); // key -> { at, promise }

const SOURCES = {
  local: { name: 'Your pages', weight: 1.35 },
  brave: { name: 'Brave Search', weight: 1.25, key: true },
  mojeek: { name: 'Mojeek', weight: 1.2, key: true },
  wikipedia: { name: 'Wikipedia', weight: 1.0 },
  mwmbl: { name: 'Mwmbl', weight: 0.95 },
  marginalia: { name: 'Marginalia', weight: 0.6 },
};
const DEFAULT_SOURCES = { local: true, wikipedia: true, mwmbl: true, marginalia: true, brave: true, mojeek: true };

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function clean(text) { return String(text || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }

async function fetchText(fetchImpl, url, { timeout = 7000, accept = 'application/json', headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      credentials: 'omit',
      headers: { Accept: accept, 'Sec-GPC': '1', DNT: '1', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJson(fetchImpl, url, opts) { return JSON.parse(await fetchText(fetchImpl, url, opts)); }

/** Wikipedia in the script you typed in: Malayalam, Hindi, Tamil, Arabic … otherwise English. */
function wikiLang(query) {
  const scripts = [[/[ഀ-ൿ]/, 'ml'], [/[ऀ-ॿ]/, 'hi'], [/[஀-௿]/, 'ta'], [/[ఀ-౿]/, 'te'], [/[ಀ-೿]/, 'kn'], [/[ঀ-৿]/, 'bn'], [/[؀-ۿ]/, 'ar'], [/[Ѐ-ӿ]/, 'ru'], [/[぀-ヿ]/, 'ja'], [/[가-힯]/, 'ko'], [/[一-鿿]/, 'zh']];
  for (const [re, lang] of scripts) if (re.test(query)) return lang;
  return 'en';
}

// ---------- each source returns [{ url, title, snippet }] ----------
const fetchers = {
  async local(query, { index, page }) {
    if (!index || !index.available) return [];
    return index.search(query, { limit: 10, offset: (page - 1) * 10 });
  },
  async wikipedia(query, { fetch, page }) {
    const lang = wikiLang(query);
    const j = await fetchJson(fetch, `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=8&srprop=snippet&sroffset=${(page - 1) * 8}&srsearch=${encodeURIComponent(query)}`);
    return ((j.query && j.query.search) || []).map((r) => ({
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      title: r.title,
      snippet: clean(r.snippet),
    }));
  },
  async mwmbl(query, { fetch, page }) {
    if (page > 1) return [];
    const j = await fetchJson(fetch, `https://api.mwmbl.org/search?s=${encodeURIComponent(query)}`);
    const join = (x) => (Array.isArray(x) ? x.map((p) => (p && typeof p === 'object' ? p.value : p) || '').join('') : String(x || ''));
    return (Array.isArray(j) ? j : []).slice(0, 15).map((r) => ({ url: r.url, title: clean(join(r.title)), snippet: clean(join(r.extract)) }));
  },
  async marginalia(query, { fetch, page }) {
    if (page > 1) return [];
    const j = await fetchJson(fetch, `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?count=12`);
    return ((j && j.results) || []).map((r) => ({ url: r.url, title: clean(r.title), snippet: clean(r.description) }));
  },
  async brave(query, { fetch, page, keys }) {
    if (!keys.brave) return [];
    const j = await fetchJson(fetch, `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20&offset=${Math.min(9, page - 1)}`, { headers: { 'X-Subscription-Token': keys.brave } });
    return ((j.web && j.web.results) || []).map((r) => ({ url: r.url, title: clean(r.title), snippet: clean(r.description) }));
  },
  async mojeek(query, { fetch, page, keys }) {
    if (!keys.mojeek) return [];
    const j = await fetchJson(fetch, `https://www.mojeek.com/search?fmt=json&t=20&s=${1 + (page - 1) * 20}&api_key=${encodeURIComponent(keys.mojeek)}&q=${encodeURIComponent(query)}`);
    return ((j.response && j.response.results) || []).map((r) => ({ url: r.url, title: clean(r.title), snippet: clean(r.desc) }));
  },
};

function enabledSources(opts) {
  const on = { ...DEFAULT_SOURCES, ...(opts.sources || {}) };
  const keys = opts.keys || {};
  return Object.keys(SOURCES).filter((id) => on[id] !== false && (!SOURCES[id].key || keys[id]));
}

/** One page of merged results. Web sources are cached briefly so a search and its Summary share
 *  the work; your own page index is always read fresh, since it changes as you browse. */
function gather(query, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const ids = enabledSources(opts);
  const ctx = { fetch: opts.fetch, index: opts.index, keys: opts.keys || {}, page };
  const run = async (id) => {
    const started = Date.now();
    try {
      const results = (await fetchers[id](query, ctx)) || [];
      return { source: id, ok: true, ms: Date.now() - started, results };
    } catch (err) {
      return { source: id, ok: false, ms: Date.now() - started, error: String(err.message || err), results: [] };
    }
  };
  const webIds = ids.filter((id) => id !== 'local');
  const key = `${page}\u0000${webIds.join(',')}\u0000${query.toLowerCase()}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= CACHE_MS) {
    const promise = Promise.all(webIds.map(run));
    promise.then((lists) => { if (lists.length && !lists.some((l) => l.ok)) cache.delete(key); }, () => cache.delete(key));
    hit = { at: Date.now(), promise };
    cache.set(key, hit);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return Promise.all([ids.includes('local') ? run('local') : null, hit.promise]).then(([local, web]) => (local ? [local, ...web] : web));
}

/** Raw first page as one ranked list (used by Summary). */
async function getSerp(fetchImpl, query, opts = {}) {
  const lists = await gather(query, { ...opts, fetch: fetchImpl });
  const results = core.websearch.fuse(query, lists.map((l) => ({ source: l.source, weight: SOURCES[l.source].weight, results: l.results })), { limit: 30 });
  return { results, next: { page: 2 } };
}

// ---------- knowledge panel from Wikipedia ----------
function panelCandidate(query, results) {
  const q = query.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!q || q.split(' ').length > 6) return null;
  const wiki = results.find((r) => /(^|\.)wikipedia\.org$/.test(r.host) && /\/wiki\//.test(r.url));
  if (!wiki) return null;
  const title = decodeURIComponent(wiki.url.split('/wiki/')[1] || '').replace(/_/g, ' ');
  const t = title.toLowerCase().replace(/\s*\(.*\)$/, '');
  return t === q || q.includes(t) || t.includes(q) ? { url: wiki.url, title } : null;
}
async function wikiSummary(fetchImpl, url) {
  const u = new URL(url);
  const title = u.pathname.split('/wiki/')[1];
  const j = await fetchJson(fetchImpl, `https://${u.hostname}/api/rest_v1/page/summary/${title}`, { timeout: 5000 });
  if (!j || j.type === 'disambiguation' || !j.extract) return null;
  return {
    title: j.title,
    text: clean(j.extract),
    image: (j.thumbnail && j.thumbnail.source) || '',
    source: 'Wikipedia',
    url: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || url,
    facts: j.description ? [{ label: 'About', value: clean(j.description) }] : [],
  };
}
async function getInstant(fetchImpl, query, opts = {}) {
  try {
    const { results } = await getSerp(fetchImpl, query, opts);
    const c = panelCandidate(query, results);
    const p = c ? await wikiSummary(fetchImpl, c.url) : null;
    return p ? { heading: p.title, abstract: p.text, source: p.source, url: p.url, image: p.image, answer: '', facts: p.facts, related: [] } : null;
  } catch { return null; }
}

/**
 * Search. `next` (from a previous call) fetches the following page; `seen` are URLs already shown.
 * opts: { fetch, index, sources, keys }
 */
async function search(query, { fetch: fetchImpl, next = null, seen = [], index = null, sources = null, keys = {} } = {}) {
  const started = Date.now();
  const page = next && Number(next.page) > 1 ? Math.min(10, Number(next.page)) : 1;
  const lists = await gather(query, { fetch: fetchImpl, index, sources, keys, page });
  const web = lists.filter((l) => l.source !== 'local');
  if (web.length && !web.some((l) => l.ok) && !lists.some((l) => l.results.length)) {
    throw new Error('Lantern Search couldn’t reach any of its sources. Check your internet connection and try again.');
  }
  const results = core.websearch.fuse(query, lists.map((l) => ({ source: l.source, weight: SOURCES[l.source].weight, results: l.results })), { seen, limit: 30 });
  let panel = null;
  let related = [];
  if (page === 1) {
    const c = panelCandidate(query, results);
    if (c) { try { panel = await wikiSummary(fetchImpl, c.url); } catch {} }
    const wl = lists.find((l) => l.source === 'wikipedia');
    related = wl ? wl.results.map((r) => r.title).filter((t) => t.toLowerCase() !== query.toLowerCase() && (!panel || t !== panel.title)).slice(0, 6) : [];
  }
  const more = lists.some((l) => l.ok && l.results.length >= 8 && ['wikipedia', 'brave', 'mojeek', 'local'].includes(l.source));
  return {
    query,
    results: results.map((r) => ({ ...r, sources: r.sources.map((s) => SOURCES[s] ? SOURCES[s].name : s) })),
    next: more ? { page: page + 1 } : null,
    panel,
    answer: '',
    related,
    sources: lists.map((l) => ({ id: l.source, name: SOURCES[l.source].name, ok: l.ok, count: l.results.length, ms: l.ms })),
    tookMs: Date.now() - started,
  };
}

// ---------- search suggestions (as you type) ----------
// From Wikipedia's title search (["query", ["s1", "s2"], …]) plus titles from your own page index.
const acCache = new Map();
function parseSuggestions(text, query) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { return []; }
  let list = [];
  if (Array.isArray(data) && Array.isArray(data[1])) list = data[1];
  else if (Array.isArray(data)) list = data.map((x) => (x && typeof x === 'object' ? x.phrase || x.title : x));
  const q = clean(query).toLowerCase();
  const seen = new Set();
  return list
    .map((x) => clean(x).slice(0, 120))
    .filter((x) => x && x.toLowerCase() !== q && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, 8);
}
async function suggest(query, { fetch: fetchImpl, index = null } = {}) {
  const q = clean(query).slice(0, 120);
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = acCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.list;
  const local = index && index.available ? index.suggest(q, 3).map((r) => r.title).filter(Boolean) : [];
  let remote = [];
  if (fetchImpl) {
    try {
      const lang = wikiLang(q);
      remote = parseSuggestions(await fetchText(fetchImpl, `https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=8&namespace=0&format=json&search=${encodeURIComponent(q)}`, { timeout: 1500 }), q);
    } catch {}
  }
  const list = parseSuggestions(JSON.stringify([q, [...remote, ...local]]), q);
  acCache.set(key, { at: Date.now(), list });
  if (acCache.size > 200) acCache.delete(acCache.keys().next().value);
  return list;
}

module.exports = { search, suggest, parseSuggestions, getSerp, getInstant, fetchText, hostOf, wikiLang, SOURCES, fetchers };
