'use strict';
// Import bookmarks and history from other browsers on this computer, or from a bookmarks file
// (the HTML file Chrome, Firefox, Safari, Raindrop.io and others export). Everything is read
// locally; nothing is uploaded anywhere.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Where Chromium-family browsers keep their profiles, per platform.
function chromiumRoots() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [
      ['Google Chrome', path.join(base, 'Google', 'Chrome')],
      ['Chrome Beta', path.join(base, 'Google', 'Chrome Beta')],
      ['Brave', path.join(base, 'BraveSoftware', 'Brave-Browser')],
      ['Brave Nightly', path.join(base, 'BraveSoftware', 'Brave-Browser-Nightly')],
      ['Microsoft Edge', path.join(base, 'Microsoft Edge')],
      ['Chromium', path.join(base, 'Chromium')],
      ['Helium', path.join(base, 'net.imput.helium')],
      ['Arc', path.join(base, 'Arc', 'User Data')],
      ['Vivaldi', path.join(base, 'Vivaldi')],
      ['Opera', path.join(base, 'com.operasoftware.Opera')],
      ['Opera GX', path.join(base, 'com.operasoftware.OperaGX')],
      ['Thorium', path.join(base, 'Thorium')],
    ];
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      ['Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
      ['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
      ['Brave Nightly', path.join(local, 'BraveSoftware', 'Brave-Browser-Nightly', 'User Data')],
      ['Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
      ['Chromium', path.join(local, 'Chromium', 'User Data')],
      ['Helium', path.join(local, 'imput', 'Helium', 'User Data')],
      ['Arc', path.join(local, 'Packages', 'TheBrowserCompany.Arc_ttt1ap7aakyb4', 'LocalCache', 'Local', 'Arc', 'User Data')],
      ['Vivaldi', path.join(local, 'Vivaldi', 'User Data')],
      ['Opera', path.join(roaming, 'Opera Software', 'Opera Stable')],
      ['Opera GX', path.join(roaming, 'Opera Software', 'Opera GX Stable')],
    ];
  }
  const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    ['Google Chrome', path.join(cfg, 'google-chrome')],
    ['Brave', path.join(cfg, 'BraveSoftware', 'Brave-Browser')],
    ['Microsoft Edge', path.join(cfg, 'microsoft-edge')],
    ['Chromium', path.join(cfg, 'chromium')],
    ['Helium', path.join(cfg, 'net.imput.helium')],
    ['Vivaldi', path.join(cfg, 'vivaldi')],
    ['Opera', path.join(cfg, 'opera')],
  ];
}
function firefoxRoot() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Firefox');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox');
  return path.join(home, '.mozilla', 'firefox');
}

const exists = (p) => { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; } };

/** Every browser profile Lantern can read: [{ id, browser, profile, bookmarks, history }]. */
function listSources() {
  const out = [];
  for (const [browser, root] of chromiumRoots()) {
    if (!exists(root)) continue;
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    // Opera keeps its single profile in the root folder.
    const dirs = names.filter((n) => n === 'Default' || /^Profile \d+$/.test(n)).map((n) => path.join(root, n));
    if (!dirs.length && exists(path.join(root, 'Bookmarks'))) dirs.push(root);
    let profileNames = {};
    try { profileNames = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8')).profile.info_cache || {}; } catch {}
    for (const dir of dirs) {
      const b = path.join(dir, 'Bookmarks');
      const h = path.join(dir, 'History');
      if (!exists(b) && !exists(h)) continue;
      const key = path.basename(dir);
      const label = (profileNames[key] && profileNames[key].name) || (key === 'Default' || dir === root ? '' : key);
      out.push({ id: `${browser}|${dir}`, kind: 'chromium', browser, profile: label, dir, bookmarks: exists(b), history: exists(h) });
    }
  }
  const ff = firefoxRoot();
  const ffProfiles = path.join(ff, 'Profiles');
  for (const base of [ffProfiles, ff]) {
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names) {
      const dir = path.join(base, n);
      if (!exists(path.join(dir, 'places.sqlite'))) continue;
      out.push({ id: `Firefox|${dir}`, kind: 'firefox', browser: 'Firefox', profile: n.replace(/^[a-z0-9]+\./, ''), dir, bookmarks: true, history: true });
    }
  }
  return out;
}

// Chrome stores times as microseconds since 1601.
const chromeTime = (t) => (Number(t) ? Math.round(Number(t) / 1000 - 11644473600000) : 0);

function chromiumBookmarks(dir) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'Bookmarks'), 'utf8'));
  const out = [];
  const walk = (node, folder) => {
    if (!node) return;
    if (node.type === 'url') out.push({ url: node.url, title: node.name, folder, added: chromeTime(node.date_added) });
    for (const c of node.children || []) walk(c, node.type === 'folder' && node.name && !['Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks', 'Mobile bookmarks'].includes(node.name) ? (folder ? `${folder} / ${node.name}` : node.name) : folder);
  };
  for (const root of Object.values(data.roots || {})) if (root && typeof root === 'object') walk(root, '');
  return out;
}

// The history databases are locked while their browser runs, so read a copy.
function withCopy(file, fn) {
  const tmp = path.join(os.tmpdir(), `lantern-import-${process.pid}-${Date.now()}.sqlite`);
  fs.copyFileSync(file, tmp);
  for (const ext of ['-wal', '-shm']) { try { fs.copyFileSync(file + ext, tmp + ext); } catch {} }
  try { return fn(tmp); } finally { for (const ext of ['', '-wal', '-shm']) { try { fs.rmSync(tmp + ext, { force: true }); } catch {} } }
}
function sqlite() {
  try { return require('node:sqlite'); } catch { return null; }
}

function chromiumHistory(dir, limit = 5000) {
  const sql = sqlite();
  if (!sql) throw new Error('History import needs a newer Lantern build.');
  return withCopy(path.join(dir, 'History'), (file) => {
    const db = new sql.DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare('SELECT url, title, visit_count AS visits, last_visit_time AS t FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?')
        .all(limit).map((r) => ({ url: r.url, title: r.title, visits: r.visits, last: chromeTime(r.t) }));
    } finally { db.close(); }
  });
}

function firefoxData(dir, limit = 5000) {
  const sql = sqlite();
  if (!sql) throw new Error('Firefox import needs a newer Lantern build.');
  return withCopy(path.join(dir, 'places.sqlite'), (file) => {
    const db = new sql.DatabaseSync(file, { readOnly: true });
    try {
      const history = db.prepare('SELECT url, title, visit_count AS visits, last_visit_date AS t FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?')
        .all(limit).map((r) => ({ url: r.url, title: r.title, visits: r.visits, last: Math.round(Number(r.t) / 1000) }));
      const bookmarks = db.prepare(`SELECT p.url AS url, b.title AS title, b.dateAdded AS added, f.title AS folder
        FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk LEFT JOIN moz_bookmarks f ON f.id = b.parent WHERE b.type = 1`)
        .all().map((r) => ({ url: r.url, title: r.title, added: Math.round(Number(r.added) / 1000), folder: ['toolbar', 'menu', 'unfiled', 'mobile', 'Bookmarks Toolbar', 'Bookmarks Menu', 'Other Bookmarks'].includes(r.folder) ? '' : (r.folder || '') }));
      return { history, bookmarks };
    } finally { db.close(); }
  });
}

/** Reads one source. what = { bookmarks, history }. */
function read(source, what = { bookmarks: true, history: true }) {
  const out = { bookmarks: [], history: [] };
  if (source.kind === 'firefox') {
    const d = firefoxData(source.dir);
    if (what.bookmarks) out.bookmarks = d.bookmarks;
    if (what.history) out.history = d.history;
    return out;
  }
  if (what.bookmarks && source.bookmarks) out.bookmarks = chromiumBookmarks(source.dir);
  if (what.history && source.history) out.history = chromiumHistory(source.dir);
  return out;
}

const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Parses a Netscape-format bookmarks file into [{url, title, folder, added}]. */
function parseBookmarksHtml(html) {
  const out = [];
  const stack = [];
  let pending = null;
  const re = /<DT>\s*<H3[^>]*>([\s\S]*?)<\/H3>|<DL>|<\/DL>|<DT>\s*<A\s+([^>]*)>([\s\S]*?)<\/A>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, 4).toUpperCase();
    if (m[1] !== undefined) pending = decode(m[1].trim());
    else if (tag === '<DL>') { stack.push(pending || ''); pending = null; }
    else if (tag === '</DL') stack.pop();
    else if (m[2] !== undefined) {
      const href = /HREF\s*=\s*"([^"]*)"/i.exec(m[2]);
      const add = /ADD_DATE\s*=\s*"(\d+)"/i.exec(m[2]);
      if (!href) continue;
      const folder = stack.filter(Boolean).filter((f) => !/^(bookmarks( bar| toolbar| menu)?|other bookmarks|unsorted)$/i.test(f)).join(' / ');
      out.push({ url: decode(href[1]), title: decode(m[3].replace(/<[^>]+>/g, '').trim()), folder, added: add ? Number(add[1]) * 1000 : 0 });
    }
  }
  return out;
}

module.exports = { listSources, read, parseBookmarksHtml };
