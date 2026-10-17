'use strict';
// Lantern's own search index: the text of pages you've visited, kept in a SQLite full-text index
// on this computer. Lantern Search looks here first, so the pages you've actually read come up.
// Nothing in it is ever sent anywhere. Private windows, pages with password boxes and sign-in or
// mail pages are never added, and clearing history clears it too.

const fs = require('fs');
const path = require('path');

const MAX_PAGES = 20000;
const MAX_TEXT = 20000;
// Pages that are personal by nature: mail, sign-in, banking, checkout.
const SKIP_HOST = /^(mail|accounts|login|signin|auth|secure|bank|banking|netbanking|wallet|pay|checkout|myaccount)\.|(^|\.)(paypal|paytm|phonepe|razorpay|stripe)\.com$|(^|\.)(mail\.google|outlook\.live|mail\.yahoo|mail\.zoho|mail\.proton)\./i;
const SKIP_PATH = /\/(login|signin|sign-in|logout|account|checkout|cart|payment|inbox|settings|admin|wp-admin|oauth|auth)(\/|$|\?)/i;

function sqlite() { try { return require('node:sqlite'); } catch { return null; } }

class PageIndex {
  constructor(dir, core) {
    this.core = core;
    this.db = null;
    const sql = sqlite();
    if (!sql) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.db = new sql.DatabaseSync(path.join(dir, 'pages.db'));
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(url UNINDEXED, title, host, body, visited UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
      `);
      this.q = {
        del: this.db.prepare('DELETE FROM pages WHERE url = ?'),
        add: this.db.prepare('INSERT INTO pages (url, title, host, body, visited) VALUES (?, ?, ?, ?, ?)'),
        last: this.db.prepare('SELECT visited FROM pages WHERE url = ? LIMIT 1'),
        count: this.db.prepare('SELECT count(*) AS n FROM pages'),
        trim: this.db.prepare('DELETE FROM pages WHERE rowid IN (SELECT rowid FROM pages ORDER BY CAST(visited AS INTEGER) ASC LIMIT ?)'),
        search: this.db.prepare(`SELECT url, title, host, snippet(pages, 3, '', '', '…', 28) AS snip, CAST(visited AS INTEGER) AS visited, bm25(pages, 0, 9.0, 4.0, 1.0, 0) AS score
          FROM pages WHERE pages MATCH ? ORDER BY score LIMIT ? OFFSET ?`),
        titles: this.db.prepare(`SELECT title, url FROM pages WHERE pages MATCH ? ORDER BY bm25(pages, 0, 9.0, 4.0, 1.0, 0) LIMIT ?`),
      };
    } catch (err) {
      console.error('[pageindex] unavailable:', err.message);
      this.db = null;
    }
  }

  get available() { return !!this.db; }

  /** Whether a page may be indexed at all. */
  static allowed(url) {
    let u; try { u = new URL(url); } catch { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (/^(localhost|127\.|10\.|192\.168\.|\[)/.test(u.hostname) && !process.env.LANTERN_INDEX_LOCAL) return false;
    if (SKIP_HOST.test(u.hostname) || SKIP_PATH.test(u.pathname)) return false;
    if (/[?&](token|session|sid|key|code|auth|password)=/i.test(u.search)) return false;
    return true;
  }

  add({ url, title, text }) {
    if (!this.db || !PageIndex.allowed(url)) return false;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (clean.length < 200) return false;
    const now = Date.now();
    const prev = this.q.last.get(url);
    // Re-read a page at most every six hours.
    if (prev && now - Number(prev.visited) < 6 * 3600 * 1000) return false;
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    try {
      this.q.del.run(url);
      this.q.add.run(url, String(title || '').slice(0, 300), host, clean, String(now));
      if (Math.random() < 0.02) { const n = this.count(); if (n > MAX_PAGES) this.q.trim.run(n - MAX_PAGES); }
      return true;
    } catch { return false; }
  }

  _match(query) {
    try { return this.core.websearch.ftsQuery(query); } catch { return { all: '', any: '' }; }
  }

  /** Best matches for a query: every word must match; if nothing does, any word may. */
  search(query, { limit = 10, offset = 0 } = {}) {
    if (!this.db) return [];
    const m = this._match(query);
    if (!m.all) return [];
    try {
      let rows = this.q.search.all(m.all, limit, offset);
      if (!rows.length && !offset && m.any !== m.all) rows = this.q.search.all(m.any, Math.min(limit, 5), 0);
      return rows.map((r) => ({ url: r.url, title: r.title, snippet: r.snip, host: r.host, visited: r.visited }));
    } catch { return []; }
  }

  /** Page titles for search suggestions. */
  suggest(prefix, limit = 4) {
    if (!this.db) return [];
    const m = this._match(prefix);
    if (!m.all) return [];
    try { return this.q.titles.all(m.all, limit).map((r) => ({ title: r.title, url: r.url })); } catch { return []; }
  }

  count() { if (!this.db) return 0; try { return Number(this.q.count.get().n) || 0; } catch { return 0; } }
  remove(url) { if (this.db) try { this.q.del.run(url); } catch {} }
  clear() { if (this.db) try { this.db.exec('DELETE FROM pages'); this.db.exec("INSERT INTO pages(pages) VALUES('optimize')"); } catch {} }
  close() { if (this.db) try { this.db.close(); } catch {} this.db = null; }
}

module.exports = { PageIndex };
