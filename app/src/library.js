'use strict';
// History and bookmarks for one profile, kept on this device only. Searching and ranking them
// (for the address bar and the History page) is done by the Rust core.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./core');

const MAX_HISTORY = 5000;
const MAX_BOOKMARKS = 2000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function cleanUrl(url) {
  const u = String(url || '');
  if (u.length > 4000 || !/^https?:\/\//i.test(u)) return '';
  return u;
}
function cleanTitle(title, url) {
  return String(title || '').replace(/\s+/g, ' ').trim().slice(0, 300) || url;
}

class Library {
  constructor(dir, { memoryOnly = false } = {}) {
    this.memoryOnly = memoryOnly;
    this.historyFile = path.join(dir, 'history.json');
    this.bookmarksFile = path.join(dir, 'bookmarks.json');
    this.history = memoryOnly ? [] : readJson(this.historyFile, []).filter((h) => h && cleanUrl(h.url));
    this.bookmarks = memoryOnly ? [] : readJson(this.bookmarksFile, []).filter((b) => b && cleanUrl(b.url) && b.id);
    this._byUrl = new Map(this.history.map((h) => [h.url, h]));
    this._saveTimer = null;
  }

  // ---------- history ----------
  visit(url, title) {
    url = cleanUrl(url);
    if (!url || this.memoryOnly) return;
    const now = Date.now();
    let h = this._byUrl.get(url);
    if (h) {
      h.visits = (h.visits || 0) + 1;
      h.last = now;
      if (title) h.title = cleanTitle(title, url);
    } else {
      h = { url, title: cleanTitle(title, url), visits: 1, first: now, last: now };
      this.history.push(h);
      this._byUrl.set(url, h);
      if (this.history.length > MAX_HISTORY) {
        this.history.sort((a, b) => b.last - a.last);
        for (const old of this.history.splice(MAX_HISTORY)) this._byUrl.delete(old.url);
      }
    }
    this.scheduleSave();
  }
  setTitle(url, title) {
    const h = this._byUrl.get(url);
    if (h && title && title !== h.title) { h.title = cleanTitle(title, url); this.scheduleSave(); }
    const b = this.bookmarks.find((x) => x.url === url);
    if (b && title && b.title === b.url) { b.title = cleanTitle(title, url); this.saveBookmarks(); }
  }
  queryHistory({ text = '', before = 0, limit = 100 } = {}) {
    const q = String(text || '').trim();
    limit = Math.max(1, Math.min(500, Number(limit) || 100));
    if (q) {
      const ranked = core.rank(q, this.history, { limit: 300 });
      return ranked.map((r) => this.history[r.i]).slice(0, limit);
    }
    return this.history
      .filter((h) => !before || h.last < before)
      .sort((a, b) => b.last - a.last)
      .slice(0, limit);
  }
  removeHistory(urls) {
    const set = new Set((Array.isArray(urls) ? urls : [urls]).map(String));
    this.history = this.history.filter((h) => !set.has(h.url));
    for (const u of set) this._byUrl.delete(u);
    this.saveNow();
  }
  clearHistory(sinceMs = 0) {
    if (sinceMs > 0) {
      const cutoff = Date.now() - sinceMs;
      this.history = this.history.filter((h) => h.last < cutoff);
    } else this.history = [];
    this._byUrl = new Map(this.history.map((h) => [h.url, h]));
    this.saveNow();
  }
  scheduleSave() {
    if (this.memoryOnly || this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.saveNow(), 2000);
  }
  saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (this.memoryOnly) return;
    try { writeAtomic(this.historyFile, JSON.stringify(this.history)); } catch {}
  }

  // ---------- bookmarks ----------
  isBookmarked(url) { return this.bookmarks.some((b) => b.url === url); }
  listBookmarks() { return this.bookmarks.slice(); }
  addBookmark({ url, title, favicon }) {
    url = cleanUrl(url);
    if (!url) throw new Error('Only web pages can be bookmarked');
    const existing = this.bookmarks.find((b) => b.url === url);
    if (existing) return existing;
    if (this.bookmarks.length >= MAX_BOOKMARKS) throw new Error('Too many bookmarks');
    const b = {
      id: crypto.randomBytes(6).toString('hex'),
      url,
      title: cleanTitle(title, url),
      favicon: /^(https:|data:image\/)/.test(String(favicon || '')) && String(favicon).length < 100_000 ? String(favicon) : '',
      added: Date.now(),
    };
    this.bookmarks.push(b);
    this.saveBookmarks();
    return b;
  }
  updateBookmark(id, patch = {}) {
    const b = this.bookmarks.find((x) => x.id === id);
    if (!b) throw new Error('No such bookmark');
    if (typeof patch.title === 'string') b.title = cleanTitle(patch.title, b.url);
    if (typeof patch.url === 'string') {
      const u = cleanUrl(patch.url.trim());
      if (!u) throw new Error('Use a web address that starts with http:// or https://');
      b.url = u;
    }
    this.saveBookmarks();
    return b;
  }
  moveBookmark(id, to) {
    const from = this.bookmarks.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [b] = this.bookmarks.splice(from, 1);
    this.bookmarks.splice(Math.max(0, Math.min(this.bookmarks.length, Number(to) || 0)), 0, b);
    this.saveBookmarks();
  }
  removeBookmark(idOrUrl) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== idOrUrl && b.url !== idOrUrl);
    this.saveBookmarks();
  }
  saveBookmarks() {
    if (this.memoryOnly) return;
    try { writeAtomic(this.bookmarksFile, JSON.stringify(this.bookmarks, null, 1)); } catch {}
  }

  // ---------- address bar ----------
  // History and bookmarks that match what's typed, best first, with an inline completion.
  suggest(text, limit = 4) {
    const marked = new Set(this.bookmarks.map((b) => b.url));
    const items = this.history.map((h) => ({ ...h, bookmark: marked.has(h.url) }));
    for (const b of this.bookmarks) if (!this._byUrl.has(b.url)) items.push({ url: b.url, title: b.title, visits: 0, last: b.added, bookmark: true });
    if (!items.length) return [];
    return core.rank(text, items, { limit }).map((r) => ({ ...items[r.i], inline: r.inline }));
  }
}

module.exports = { Library };
