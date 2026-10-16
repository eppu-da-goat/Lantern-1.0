'use strict';
// Lantern summary: reads the top results with Mozilla Readability and builds an extractive
// summary — the most relevant sentences from those pages, each cited. No AI model is involved,
// so every sentence shown comes word for word from a source.

const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const { getSerp, getInstant } = require('./search');

const MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 7000;
const MAX_PAGE_BYTES = 2_000_000;
const SKIP_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|pinterest\.[a-z.]+|linkedin\.com|reddit\.com)$/i;

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have how i if in into is it its ' +
  'me more most my no not of on or our so than that the their them then there these they this to too was we were what when ' +
  'where which who why will with you your about after also all any because before being both each few further here just ' +
  'off once only other out over own same should some such through under until up very while would one two new get got best').split(' '));

// Sentences that only make sense inside their article (list intros, sign-posting, calls to action).
const FRAMING = new RegExp([
  '\\bhere (are|is|\'s)\\b', '\\bin this (article|post|guide|piece|list|video)\\b', '\\b(below|above)\\b',
  '\\bread on\\b', '\\blet\'s\\b', '\\bwe(\'ve|\'ll| will| have| are|\'re)\\b', '\\bthis list\\b',
  '\\bwith (all )?(that|this) in mind\\b', '\\bas things stand\\b', '\\bclick\\b', '\\byou\'ll find\\b',
  '\\bkeep reading\\b', '\\bcheck out\\b', '\\bour (list|ranking|picks|guide)\\b', '\\bin no particular order\\b',
  '\\bsee (more|also)\\b', '\\bfollowing\\b',
].join('|'), 'i');

// ---------- text helpers ----------
function stem(w) {
  return w.replace(/(ies)$/, 'y').replace(/(ing|edly|ed|ly|es|s)$/, '').slice(0, 12);
}
function tokens(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}
function splitSentences(text) {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out = [];
  for (const para of text.split(/\n\s*\n|\n/)) {
    const p = para.replace(/\s+/g, ' ').trim();
    if (p.length < 40) continue;
    for (const { segment } of seg.segment(p)) {
      const s = segment.trim();
      if (s) out.push(s);
    }
  }
  return out;
}
function looksLikeProse(s) {
  if (s.length < 50 || s.length > 300) return false;
  if (!/[.!?]["')\]]?$/.test(s)) return false;
  if (/[:]\s*$/.test(s)) return false;
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters / s.length < 0.6) return false;
  if (/cookie|subscribe|newsletter|sign up|log in|javascript|all rights reserved|advertisement|affiliate|sponsored/i.test(s)) return false;
  if ((s.match(/\|/g) || []).length > 1) return false;
  if (/^(it|this|that|these|those|they|he|she|its|such|however|but|also|and|so|then|still|yet|plus|meanwhile)\b/i.test(s)) return false;
  if (FRAMING.test(s)) return false;
  if (/\?$/.test(s)) return false;
  return true;
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function extractArticle(html, url) {
  const { document } = parseHTML(html);
  try { Object.defineProperty(document, 'documentURI', { value: url }); } catch {}
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head?.appendChild(base);
  const art = new Readability(document, { charThreshold: 300 }).parse();
  if (!art || !art.textContent) return null;
  return {
    title: (art.title || '').trim(),
    site: (art.siteName || '').trim() || hostOf(url),
    text: art.textContent,
  };
}

// ---------- ranking ----------
function summarize(query, sources, instant) {
  const qTerms = new Set(tokens(query));
  const sents = [];
  sources.forEach((src, si) => {
    splitSentences(src.text).forEach((s, pos) => {
      if (!looksLikeProse(s)) return;
      const t = tokens(s);
      if (t.length < 6) return;
      sents.push({ text: s, tokens: t, source: si, pos });
    });
  });
  if (!sents.length) return { overview: instant?.abstract || '', overviewSource: instant?.abstract ? { title: instant.source, url: instant.url } : null, points: [] };

  const df = new Map();
  for (const s of sents) for (const w of new Set(s.tokens)) df.set(w, (df.get(w) || 0) + 1);
  const N = sents.length;
  const idf = (w) => Math.log(1 + N / (df.get(w) || 1));

  // Sentences that echo what several sources say rank higher (centroid similarity).
  const centroid = new Map();
  for (const s of sents) for (const w of s.tokens) centroid.set(w, (centroid.get(w) || 0) + idf(w));
  const cNorm = Math.sqrt([...centroid.values()].reduce((a, v) => a + v * v, 0)) || 1;

  for (const s of sents) {
    const tf = new Map();
    for (const w of s.tokens) tf.set(w, (tf.get(w) || 0) + idf(w));
    let dot = 0, n = 0;
    for (const [w, v] of tf) { dot += v * (centroid.get(w) || 0); n += v * v; }
    const centrality = dot / ((Math.sqrt(n) || 1) * cNorm);
    let qHits = 0;
    for (const w of new Set(s.tokens)) if (qTerms.has(w)) qHits++;
    const coverage = qTerms.size ? qHits / qTerms.size : 0;
    const early = 1 / (1 + s.pos / 6);
    const rank = 1 / (1 + s.source * 0.15);
    const firstPerson = /\b(I|my|me|our|us)\b/.test(s.text) ? 0.75 : 1;
    s.score = (0.45 * centrality + 0.4 * coverage + 0.15 * early) * rank * firstPerson;
  }

  sents.sort((a, b) => b.score - a.score);
  const overviewTokens = instant?.abstract ? tokens(instant.abstract) : null;
  const chosen = [];
  const perSource = new Map();
  for (const s of sents) {
    if (chosen.length >= 6) break;
    if ((perSource.get(s.source) || 0) >= 2) continue;
    if (chosen.some((c) => jaccard(c.tokens, s.tokens) > 0.45)) continue;
    if (overviewTokens && jaccard(overviewTokens, s.tokens) > 0.35) continue;
    chosen.push(s);
    perSource.set(s.source, (perSource.get(s.source) || 0) + 1);
  }

  let overview = instant?.abstract || '';
  let overviewSource = instant?.abstract ? { title: instant.source, url: instant.url } : null;
  let points = chosen;
  if (!overview && chosen.length) {
    // Without a reference answer, open with the two strongest sentences from different sources.
    const first = chosen[0];
    const second = chosen.find((c) => c.source !== first.source);
    overview = first.text;
    overviewSource = { index: first.source, also: second ? second.source : undefined };
    points = chosen.slice(1);
  }
  return { overview, overviewSource, points: points.map((s) => ({ text: s.text, source: s.source })) };
}

// ---------- network ----------
async function fetchPage(fetchImpl, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: 'text/html', 'Accept-Language': 'en;q=0.9', 'Sec-GPC': '1', DNT: '1' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/html|xml/.test(res.headers.get('content-type') || '')) throw new Error('not html');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PAGE_BYTES) throw new Error('too large');
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a summary for a query.
 * @param {string} query
 * @param {{ fetch: typeof fetch, onProgress?: (step: string) => void }} opts
 */
async function buildSummary(query, { fetch: fetchImpl, onProgress = () => {} }) {
  const started = Date.now();
  onProgress('Searching');
  const [serp, instant] = await Promise.all([getSerp(fetchImpl, query), getInstant(fetchImpl, query)]);
  const results = serp.results;
  const candidates = results.filter((r) => !SKIP_HOSTS.test(r.host) && !/\.pdf($|\?)/i.test(r.url));

  onProgress(`Reading ${Math.min(MAX_PAGES, candidates.length)} pages`);
  const picked = candidates.slice(0, MAX_PAGES + 2);
  const pages = await Promise.all(picked.map(async (r) => {
    try {
      const art = extractArticle(await fetchPage(fetchImpl, r.url), r.url);
      if (!art || art.text.length < 400) return null;
      return { ...r, title: art.title || r.title, site: art.site, text: art.text };
    } catch {
      return null;
    }
  }));
  const sources = pages.filter(Boolean).slice(0, MAX_PAGES);
  if (!sources.length) {
    for (const r of results.slice(0, MAX_PAGES)) if (r.snippet) sources.push({ ...r, site: r.host, text: r.snippet });
  }

  onProgress('Picking the key points');
  const sum = summarize(query, sources, instant);
  return {
    query,
    overview: sum.overview,
    overviewSource: sum.overviewSource,
    points: sum.points,
    sources: sources.map((s) => ({ title: s.title, url: s.url, site: s.site || s.host, host: s.host })),
    tookMs: Date.now() - started,
  };
}

module.exports = { buildSummary, summarize, extractArticle, splitSentences, looksLikeProse };
