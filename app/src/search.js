'use strict';
// Lantern Search: gets results from DuckDuckGo's HTML endpoint and Instant Answer API,
// then re-ranks them locally (dedupe, domain variety, quality signals) and builds a knowledge panel.

const { parseHTML } = require('linkedom');

const SERP_URL = 'https://html.duckduckgo.com/html/';
const CACHE_MS = 3 * 60 * 1000;
const cache = new Map(); // key -> { at, promise }

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function siteOf(host) {
  const parts = String(host || '').split('.');
  if (parts.length <= 2) return host;
  const two = parts.slice(-2).join('.');
  return /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join('.') : two;
}
function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

async function fetchText(fetchImpl, url, { timeout = 8000, accept = 'text/html', method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      method,
      body,
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        Accept: accept,
        'Accept-Language': 'en;q=0.9',
        'Sec-GPC': '1',
        DNT: '1',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseSerp(html) {
  const { document } = parseHTML(html);
  const results = [];
  for (const node of document.querySelectorAll('.result')) {
    if (node.classList.contains('result--ad')) continue;
    const a = node.querySelector('a.result__a');
    if (!a) continue;
    let href = a.getAttribute('href') || '';
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
      else if (u.hostname.endsWith('duckduckgo.com')) continue;
    } catch { continue; }
    if (!/^https?:\/\//.test(href)) continue;
    results.push({
      title: clean(a.textContent),
      url: href,
      snippet: clean(node.querySelector('.result__snippet')?.textContent),
      host: hostOf(href),
    });
  }
  // DuckDuckGo's "Next" button is a form; keep its fields so the next page can be requested.
  let next = null;
  for (const form of document.querySelectorAll('.nav-link form, form.nav-link')) {
    const submit = form.querySelector('input[type="submit"]');
    if (submit && !/next/i.test(submit.getAttribute('value') || '')) continue;
    const fields = {};
    for (const input of form.querySelectorAll('input[name]')) fields[input.getAttribute('name')] = input.getAttribute('value') || '';
    if (Object.keys(fields).length) next = fields;
  }
  return { results, next };
}

async function instantAnswer(fetchImpl, query) {
  try {
    const raw = await fetchText(fetchImpl,
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=lantern`,
      { accept: 'application/json', timeout: 5000 });
    const j = JSON.parse(raw);
    const related = (j.RelatedTopics || [])
      .flatMap((t) => (t.Topics ? t.Topics : [t]))
      .map((t) => clean((t.Text || '').split(' - ')[0]))
      .filter((t) => t && t.length < 60)
      .slice(0, 6);
    const facts = ((j.Infobox && j.Infobox.content) || [])
      .filter((f) => f && f.label && typeof f.value === 'string' && f.value.length < 80 && f.data_type === 'string')
      .slice(0, 6)
      .map((f) => ({ label: clean(f.label), value: clean(f.value) }));
    return {
      heading: clean(j.Heading),
      abstract: clean(j.AbstractText),
      source: clean(j.AbstractSource),
      url: j.AbstractURL || '',
      image: j.Image ? (j.Image.startsWith('http') ? j.Image : 'https://duckduckgo.com' + j.Image) : '',
      answer: clean(j.Answer),
      definition: clean(j.Definition),
      facts,
      related,
    };
  } catch {
    return null;
  }
}

// Re-rank: drop duplicates, keep at most two results per site near the top, and nudge
// reference-style and official pages up a little.
function rerank(query, results, seen = new Set()) {
  const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const scored = [];
  results.forEach((r, i) => {
    const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, '');
    if (seen.has(key)) return;
    seen.add(key);
    let score = 1 / (1 + i * 0.35);
    const title = r.title.toLowerCase();
    let hits = 0;
    for (const w of words) if (w.length > 2 && title.includes(w)) hits++;
    score += words.size ? 0.12 * (hits / words.size) : 0;
    if (/(^|\.)wikipedia\.org$/.test(r.host)) score += 0.08;
    if (/\.(gov|edu)(\.[a-z]{2})?$/.test(r.host)) score += 0.05;
    if (/pinterest\.|quora\.com$/.test(r.host)) score -= 0.08;
    scored.push({ ...r, score });
  });
  scored.sort((a, b) => b.score - a.score);
  const perSite = new Map();
  const top = [];
  const later = [];
  for (const r of scored) {
    const site = siteOf(r.host);
    const n = perSite.get(site) || 0;
    perSite.set(site, n + 1);
    (n < 2 ? top : later).push(r);
  }
  return [...top, ...later].map(({ score, ...r }) => r);
}

/** Raw first page of results for a query, cached briefly so search and summary share one request. */
function getSerp(fetchImpl, query) {
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = fetchText(fetchImpl, `${SERP_URL}?q=${encodeURIComponent(query)}&kp=-1`).then(parseSerp);
  promise.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), promise });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return promise;
}

function getInstant(fetchImpl, query) {
  const key = 'ia:' + query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = instantAnswer(fetchImpl, query);
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/**
 * Search. With `next` (the fields returned by a previous call), fetches the following page.
 */
async function search(query, { fetch: fetchImpl, next = null, seen = [] }) {
  const started = Date.now();
  let page;
  let instant = null;
  if (next) {
    const body = new URLSearchParams(next).toString();
    page = parseSerp(await fetchText(fetchImpl, SERP_URL, { method: 'POST', body }));
  } else {
    [page, instant] = await Promise.all([getSerp(fetchImpl, query), getInstant(fetchImpl, query)]);
  }
  const results = rerank(query, page.results, new Set(seen));
  let panel = null;
  if (instant && instant.abstract && instant.heading) {
    panel = {
      title: instant.heading,
      text: instant.abstract,
      image: instant.image,
      source: instant.source,
      url: instant.url,
      facts: instant.facts,
    };
  }
  return {
    query,
    results,
    next: page.next,
    panel,
    answer: instant ? (instant.answer || '') : '',
    related: instant ? instant.related : [],
    tookMs: Date.now() - started,
  };
}

// ---------- search suggestions (as you type) ----------
// DuckDuckGo's autocomplete endpoint answers in two shapes depending on parameters:
//   ["query", ["s1", "s2"]]   or   [{ "phrase": "s1" }, { "phrase": "s2" }]
const AC_URL = 'https://duckduckgo.com/ac/?type=list&kl=wt-wt&q=';
const acCache = new Map();
function parseSuggestions(text, query) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  let list = [];
  if (Array.isArray(data) && Array.isArray(data[1])) list = data[1];
  else if (Array.isArray(data)) list = data.map((x) => (x && typeof x === 'object' ? x.phrase : x));
  const q = clean(query).toLowerCase();
  const seen = new Set();
  return list
    .map((x) => clean(x).slice(0, 120))
    .filter((x) => x && x.toLowerCase() !== q && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, 8);
}
async function suggest(query, { fetch: fetchImpl } = {}) {
  const q = clean(query).slice(0, 120);
  if (!q || !fetchImpl) return [];
  const key = q.toLowerCase();
  const hit = acCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.list;
  try {
    const list = parseSuggestions(await fetchText(fetchImpl, AC_URL + encodeURIComponent(q), { timeout: 1500, accept: 'application/json' }), q);
    acCache.set(key, { at: Date.now(), list });
    if (acCache.size > 200) acCache.delete(acCache.keys().next().value);
    return list;
  } catch {
    return [];
  }
}

module.exports = { search, suggest, parseSuggestions, getSerp, getInstant, fetchText, parseSerp, rerank, hostOf };
