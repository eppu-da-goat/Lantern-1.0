'use strict';
const {
  app, BrowserWindow, WebContentsView, session, ipcMain, protocol, net,
  Menu, nativeTheme, clipboard, shell, dialog, nativeImage, safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { buildSummary } = require('./summary');
const { search, suggest } = require('./search');
const { reducedUserAgent } = require('./identity');
const { Profiles, ENGINES, COLORS, DEFAULT_SETTINGS } = require('./profiles');
const { setupPrivacy, hostOf } = require('./privacy');
const { ThreatLists, parseList, isRiskyFile } = require('./safety');
const { execFile } = require('child_process');
const crypto = require('crypto');
const core = require('./core');
const { AiStore, SYSTEM_PROMPT, listModels, streamChat } = require('./ai');
const { Library } = require('./library');

// ---------- constants ----------
const IS_MAC = process.platform === 'darwin';
const UI_HEIGHT = 84; // tab strip (40) + toolbar (44)
const BAR_HEIGHT = 32; // bookmarks bar, when it's shown
const PANEL_WIDTH = 392; // side panel (AI, reading mode, share)
const PAGES_DIR = path.join(__dirname, 'pages');
const INTERNAL = 'lantern://app/';
const NEWTAB_URL = INTERNAL + 'newtab.html';
const SETTINGS_URL = INTERNAL + 'settings.html';
const LIBRARY_URL = INTERNAL + 'library.html';
const PANEL_URL = INTERNAL + 'panel.html';
const KEY_PAGES = new Set(core.ai.providers().map((p) => p.keyUrl));
const TEST_SHOT_DIR = process.env.LANTERN_TEST_SHOT || '';
const USE_FIXTURES = !!process.env.LANTERN_FIXTURES;
const SAVE_EVERY_MS = 30_000;          // crash-safe session save, as Min does
const SLEEP_AFTER_MS = 30 * 60_000;     // memory saver: put idle background tabs to sleep
const UI_PARTITION = 'lantern-ui';

app.setName('Lantern');
protocol.registerSchemesAsPrivileged([
  { scheme: 'lantern', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');
// FedCM ("Sign in with Google" account chips) needs an account chooser Electron doesn't have; without
// it sites fall back to their normal pop-up sign-in, which works.
app.commandLine.appendSwitch('disable-features', 'FedCm');

let profiles;
let blocker = null;
let threats = null;
let fetchSession;
const contexts = new Map(); // profileId -> ProfileContext
const windows = new Set();  // WindowController
let quitting = false;

// ---------- helpers ----------
function isInternal(url) { return String(url || '').startsWith(INTERNAL); }
function warningUrl(type, url, extra = '') { return `${INTERNAL}warning.html?type=${type}&url=${encodeURIComponent(url)}${extra}`; }

// Mark a finished download the way the operating system expects, so it double-checks the
// file before it first runs: the quarantine flag on macOS (Gatekeeper) and the Mark of the
// Web on Windows (SmartScreen / Attachment Manager).
function markDownloadedFile(file, sourceUrl, referrer) {
  try {
    if (process.platform === 'darwin') {
      const value = `0083;${Math.floor(Date.now() / 1000).toString(16)};Lantern;${crypto.randomUUID().toUpperCase()}`;
      execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', value, file], () => {});
    } else if (process.platform === 'win32') {
      const safe = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin + x.pathname : ''; } catch { return ''; } };
      fs.writeFileSync(`${file}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=${safe(referrer)}\r\nHostUrl=${safe(sourceUrl)}\r\n`);
    }
  } catch {}
}
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function iconDataUrl(ext) {
  const icons = (ext.manifest && ext.manifest.icons) || {};
  const sizes = Object.keys(icons).map(Number).sort((a, b) => b - a);
  for (const s of sizes) {
    try {
      const img = nativeImage.createFromPath(path.join(ext.path, icons[s]));
      if (!img.isEmpty()) return img.resize({ width: 48, height: 48 }).toDataURL();
    } catch {}
  }
  return '';
}
function tabTitle(t) {
  let u;
  try { u = new URL(t.url); } catch { return t.title || t.url || 'New Tab'; }
  if (u.protocol === 'lantern:') {
    if (u.pathname === '/search.html') return u.searchParams.get('q') || 'Lantern Search';
    if (u.pathname === '/settings.html') return 'Settings';
    if (u.pathname === '/library.html') return ({ bookmarks: 'Bookmarks', downloads: 'Downloads' })[u.hash.slice(1).split('/')[0]] || 'History';
    if (u.pathname === '/newtab.html') return 'New Tab';
  }
  return t.title || t.url || 'New Tab';
}
function displayUrl(url) {
  try { const u = new URL(url); return (u.host.replace(/^www\./, '') + u.pathname + u.search).replace(/\/$/, ''); } catch { return url; }
}
function uniquePath(dir, name) {
  const safe = String(name || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

// ============================================================================
// Profile context: one session, settings, privacy layer and extension host per profile
// ============================================================================
class ProfileContext {
  // A private context (privateOf = the profile it was opened from) keeps everything in memory:
  // its cookies, cache, history and recent searches are gone when its last window closes.
  constructor(profile, { privateOf = null } = {}) {
    this.isPrivate = !!privateOf;
    this.parent = privateOf;
    this.id = privateOf ? `private:${privateOf.id}` : profile.id;
    this.partition = privateOf ? `lantern-private-${privateOf.id}` : profiles.partition(profile.id);
    this.session = session.fromPartition(this.partition);
    this.dataDir = privateOf ? privateOf.dataDir : profiles.dir(profile.id);
    this.settings = privateOf ? { ...privateOf.settings, rememberSearches: false } : profiles.loadSettings(profile.id);
    this.blockedTotal = 0;
    this.downloads = [];
    this.extensions = null;
    this.bypass = new Set();      // hosts the user chose to visit despite a warning (this session only)
    this.certBypass = new Set();  // hosts whose certificate errors the user accepted (this session only)
    // Bookmarks and AI keys are shared with the parent profile; history is never written in private.
    this.library = privateOf ? privateOf.library : new Library(this.dataDir);
    this.ai = privateOf ? privateOf.ai : new AiStore(this.dataDir, safeStorage);
    this.sessionFile = privateOf ? null : path.join(this.dataDir, 'session.json');
    this.searchesFile = privateOf ? null : path.join(this.dataDir, 'searches.json');
    this.recentSearches = privateOf ? [] : readJson(this.searchesFile, []).filter((x) => typeof x === 'string').slice(0, 30);
    this.runningMarker = privateOf ? null : path.join(this.dataDir, '.running');
    this.crashed = !privateOf && fs.existsSync(this.runningMarker);
    if (!privateOf) { try { fs.writeFileSync(this.runningMarker, String(Date.now())); } catch {} }
    this.ready = this._init();
  }

  get profile() {
    if (this.isPrivate) return { id: this.id, name: 'Private', color: '#6d5bd0', private: true };
    return profiles.get(this.id);
  }
  // The custom theme colour, worked out by the Rust core into light and dark palettes.
  palette() {
    if (this.settings.themeColor !== 'custom' || !this.settings.customAccent) return null;
    try { return core.theme.palette(this.settings.customAccent); } catch { return null; }
  }
  mail() {
    try { return core.mail.url(this.settings.mailService || 'gmail', this.settings.mailUrl || ''); } catch { return { url: null, name: null }; }
  }

  async _init() {
    const ses = this.session;
    ses.setSpellCheckerEnabled(false);
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
    const ctx = this;
    this.privacy = setupPrivacy({
      session: ses,
      get settings() { return ctx.settings; },
      saveSettings: () => this.saveSettings(),
      getBlocker: () => blocker,
      onBlocked: (wcId) => this.noteBlocked(wcId),
      tabFor: (wcId) => findTabByWebContentsId(wcId),
      getThreats: () => threats,
      isBypassed: (url) => this.bypass.has(hostOf(url)),
      onThreat: (wcId, url, kind) => {
        const found = findTabByWebContentsId(wcId, true);
        if (found) setImmediate(() => { if (found.tab.view && !found.tab.view.webContents.isDestroyed()) found.tab.view.webContents.loadURL(warningUrl(kind, url)); });
      },
    });
    serveInternal(ses, this);
    this._setupDownloads();
    if (!process.env.LANTERN_NO_EXT && !this.isPrivate) await this._setupExtensions();
  }

  async _setupExtensions() {
    try {
      const { ElectronChromeExtensions } = require('electron-chrome-extensions');
      this.extensions = new ElectronChromeExtensions({
        license: 'GPL-3.0',
        session: this.session,
        createTab: async (details) => {
          const w = this.focusedWindow() || openWindow(this, { urls: [] });
          const t = w.createTab(details.url || NEWTAB_URL, { activate: details.active !== false });
          return [t.view.webContents, w.win];
        },
        selectTab: (wc) => {
          const found = findTabByWebContentsId(wc.id, true);
          if (found) { found.win.activateTab(found.tab.id); found.win.win.focus(); }
        },
        removeTab: (wc) => {
          const found = findTabByWebContentsId(wc.id, true);
          if (found) found.win.closeTab(found.tab.id);
        },
        createWindow: async (details) => {
          const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : [];
          return openWindow(this, { urls }).win;
        },
        removeWindow: (bw) => { if (!bw.isDestroyed()) bw.close(); },
      });
      const { installChromeWebStore } = require('electron-chrome-web-store');
      await installChromeWebStore({
        session: this.session,
        extensionsPath: profiles.extensionsDir(this.id),
        allowUnpackedExtensions: true,
        beforeInstall: async (details) => {
          const win = BrowserWindow.getFocusedWindow();
          const { response } = await dialog.showMessageBox(win, {
            type: 'question',
            buttons: ['Add extension', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            message: `Add “${details.localizedName}” to Lantern?`,
            detail: 'Extensions can read and change data on the websites you visit. Only add ones you trust.',
            icon: details.icon,
          });
          return { action: response === 0 ? 'allow' : 'deny' };
        },
      });
      this.session.extensions.on('extension-loaded', () => this.broadcast());
      this.session.extensions.on('extension-unloaded', () => this.broadcast());
    } catch (err) {
      console.error('Extensions are unavailable:', err.message);
    }
  }

  _setupDownloads() {
    this.session.on('will-download', (_e, item, wc) => {
      const url = item.getURL();
      const name = item.getFilename();
      // Downloads from known malware hosts are stopped outright.
      const threat = this.settings.safeBrowsing && threats ? threats.check(url) : null;
      if (threat && !this.bypass.has(hostOf(url))) {
        item.cancel();
        const win = (wc && BrowserWindow.fromWebContents(wc)) || BrowserWindow.getFocusedWindow();
        dialog.showMessageBox(win, { type: 'warning', message: `Lantern blocked “${name}”`, detail: `It comes from ${hostOf(url)}, which is on a list of sites that spread ${threat === 'malware' ? 'malware' : 'scams'}.`, buttons: ['OK'] });
        return;
      }
      if (!this.settings.downloadsAsk) {
        const dir = this.settings.downloadsDir || app.getPath('downloads');
        try { item.setSavePath(uniquePath(dir, name)); } catch {}
      }
      const d = { id: Date.now() + Math.random(), name, state: 'progressing', received: 0, total: item.getTotalBytes(), path: '' };
      this.downloads.unshift(d);
      this.downloads = this.downloads.slice(0, 20);
      const referrer = wc && !wc.isDestroyed() ? wc.getURL() : '';
      // Files that can run code get a confirmation first, especially over plain HTTP.
      const insecure = url.startsWith('http://');
      if (this.settings.downloadWarnings && (isRiskyFile(name) || insecure)) {
        item.pause();
        const win = (wc && BrowserWindow.fromWebContents(wc)) || BrowserWindow.getFocusedWindow();
        dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Discard', 'Keep'],
          defaultId: 0,
          cancelId: 0,
          message: insecure ? `“${name}” is downloading over an insecure connection` : `“${name}” can run programs on your computer`,
          detail: `${insecure ? 'Someone on your network could change this file before it arrives.' : 'Only keep it if you trust'} ${hostOf(url) || 'this site'}${insecure ? '' : ' and expected this download.'}`,
        }).then(({ response }) => {
          if (item.getState() !== 'progressing' && item.getState() !== 'interrupted') return;
          if (response === 1) item.resume(); else item.cancel();
        });
      }
      item.on('updated', (_ev, state) => {
        d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
        d.received = item.getReceivedBytes();
        d.total = item.getTotalBytes();
        d.path = item.getSavePath();
        this.scheduleBroadcast();
      });
      item.once('done', (_ev, state) => {
        d.state = state;
        d.path = item.getSavePath();
        d.name = path.basename(d.path || d.name);
        if (state === 'completed' && d.path) markDownloadedFile(d.path, url, referrer);
        this.broadcast();
      });
      this.broadcast();
    });
  }

  // Recent searches stay on this device, in this profile, and power the "recent" suggestions.
  rememberSearch(text) {
    const q = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!q || this.isPrivate || this.settings.rememberSearches === false) return;
    this.recentSearches = [q, ...this.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 30);
    try { writeAtomic(this.searchesFile, JSON.stringify(this.recentSearches)); } catch {}
  }
  forgetSearch(text) {
    this.recentSearches = this.recentSearches.filter((x) => x !== text);
    if (this.isPrivate) return;
    try { writeAtomic(this.searchesFile, JSON.stringify(this.recentSearches)); } catch {}
  }
  clearSearches() {
    this.recentSearches = [];
    if (this.isPrivate) return;
    try { fs.rmSync(this.searchesFile, { force: true }); } catch {}
  }

  saveSettings() {
    if (!this.isPrivate) profiles.saveSettings(this.id, this.settings);
    this.applyTheme();
    this.broadcast();
    for (const w of this.windows()) w.layout();
  }
  applyTheme() {
    const t = this.settings.theme;
    nativeTheme.themeSource = t === 'light' || t === 'dark' ? t : 'system';
  }

  windows() { return [...windows].filter((w) => w.ctx === this); }
  focusedWindow() {
    const f = BrowserWindow.getFocusedWindow();
    return this.windows().find((w) => w.win === f) || this.windows()[0] || null;
  }
  broadcast() { for (const w of this.windows()) w.broadcast(); }
  scheduleBroadcast() {
    if (this._bt) return;
    this._bt = setTimeout(() => { this._bt = null; this.broadcast(); }, 250);
  }
  noteBlocked(wcId) {
    this.blockedTotal++;
    const found = findTabByWebContentsId(wcId, true);
    if (found) found.tab.blocked++;
    this.scheduleBroadcast();
  }

  // ----- crash-safe session saving (pattern learned from Min via REA) -----
  snapshot() {
    return {
      savedAt: Date.now(),
      windows: this.windows().map((w) => ({
        tabs: w.order.map((id) => w.tabs.get(id)).filter((t) => t && !/^lantern:\/\/app\/(newtab|settings|library)/.test(t.url))
          .map((t) => ({ url: t.url, title: t.title, pinned: !!t.pinned })),
      })).filter((w) => w.tabs.length),
    };
  }
  saveSession() {
    if (this.isPrivate || !this.windows().length) return;
    try { writeAtomic(this.sessionFile, JSON.stringify(this.snapshot())); } catch {}
  }
  lastSession() {
    if (this.isPrivate) return null;
    const s = readJson(this.sessionFile, null);
    return s && Array.isArray(s.windows) ? s : null;
  }
  markCleanExit() { if (this.runningMarker) { try { fs.rmSync(this.runningMarker, { force: true }); } catch {} } }

  backgroundFile() {
    const dir = this.dataDir;
    for (const ext of ['jpg', 'png', 'webp', 'gif']) {
      const f = path.join(dir, `background.${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  extensionList() {
    const exts = this.session.extensions ? this.session.extensions.getAllExtensions() : [];
    return exts.map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      description: (e.manifest && e.manifest.description) || '',
      icon: iconDataUrl(e),
      unpacked: !String(e.path).startsWith(profiles.extensionsDir(this.id)),
    }));
  }
}

function getContext(profileId) {
  let ctx = contexts.get(profileId);
  if (!ctx) {
    ctx = new ProfileContext(profiles.get(profileId) || profiles.lastUsed());
    contexts.set(ctx.id, ctx);
  }
  return ctx;
}
// One private context per profile, shared by all of that profile's private windows (like Chrome).
function getPrivateContext(base) {
  if (base.isPrivate) return base;
  const id = `private:${base.id}`;
  let ctx = contexts.get(id);
  if (!ctx) {
    ctx = new ProfileContext(null, { privateOf: base });
    contexts.set(id, ctx);
  }
  return ctx;
}
async function openPrivateWindow(base, urls = []) {
  const ctx = getPrivateContext(base || getContext(profiles.lastUsed().id));
  await ctx.ready;
  return openWindow(ctx, { urls });
}
// When the last private window closes, everything it kept in memory goes with it.
async function endPrivateSession(ctx) {
  if (!ctx.isPrivate || ctx.windows().length) return;
  contexts.delete(ctx.id);
  try { await ctx.session.clearStorageData(); await ctx.session.clearCache(); await ctx.session.clearAuthCache(); } catch {}
}

function cleanUserAgent(ua) { return reducedUserAgent(ua); }

// ============================================================================
// Window controller: tab strip, toolbar and tabs for one window
// ============================================================================
class WindowController {
  constructor(ctx, { urls = [], activeIndex = 0, pinned = [] } = {}) {
    this.ctx = ctx;
    this.tabs = new Map();
    this.order = [];
    this.activeId = null;
    this.nextId = 1;
    this.closed = [];          // recently closed tabs, for Reopen closed tab
    this.panel = null;         // the side panel view (AI, reading mode, share)
    this.panelOpen = false;
    this.panelMode = 'ai';
    this.panelQueue = [];      // messages for the panel that arrive before it has loaded
    ctx.applyTheme();
    const p = ctx.profile;
    this.win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 520,
      minHeight: 400,
      title: 'Lantern',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#e3e6ea',
      icon: path.join(__dirname, 'pages', 'assets', 'icon.png'),
      titleBarStyle: 'hidden',
      ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: overlayColors() }),
      autoHideMenuBar: true,
      show: !TEST_SHOT_DIR,
      webPreferences: {
        preload: path.join(__dirname, 'ui-preload.bundle.js'),
        partition: UI_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    windows.add(this);
    this.win.loadFile(path.join(__dirname, 'ui', 'ui.html'), {
      query: { platform: process.platform, partition: ctx.partition, color: (p && p.color) || COLORS[0], private: ctx.isPrivate ? '1' : '' },
    });
    this.win.on('resize', () => { this.layout(); if (this.suggestItems && this.suggestItems.length) { this.hideSuggestions(); this.send('omnibox-done'); } });
    this.win.on('blur', () => { if (this.suggestItems && this.suggestItems.length) { this.hideSuggestions(); this.send('omnibox-done'); } }); // switched to another app
    this.win.on('focus', () => { ctx.applyTheme(); profiles.setLastUsed(ctx.id); refreshAppMenu(); });
    this.win.on('enter-full-screen', () => { this.send('fullscreen', true); this.layout(); });
    this.win.on('leave-full-screen', () => { this.send('fullscreen', false); this.layout(); });
    this.win.webContents.on('before-input-event', (e, input) => this.handleShortcut(e, input));
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.on('close', () => {
      // Closing the last window of a profile keeps its tabs for next time.
      if (!quitting && ctx.windows().length === 1) ctx.saveSession();
    });
    this.win.on('closed', () => {
      for (const t of this.tabs.values()) if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.close();
      if (this.panel && !this.panel.webContents.isDestroyed()) this.panel.webContents.close();
      windows.delete(this);
      if (ctx.isPrivate) endPrivateSession(ctx);
    });
    this.win.webContents.once('did-finish-load', () => {
      const list = urls.length ? urls : [NEWTAB_URL];
      list.forEach((u, i) => this.createTab(u, { activate: i === activeIndex, pinned: !!pinned[i] }));
      if (!this.activeId && this.order.length) this.activateTab(this.order[0]);
    });
  }

  uiHeight() {
    const bar = this.ctx.settings.bookmarksBar && !this.win.isFullScreen();
    return UI_HEIGHT + (bar ? BAR_HEIGHT : 0);
  }

  send(channel, payload) { if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload); }

  layout() {
    if (this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const top = this.uiHeight();
    // The side panel takes the right edge, like Chrome's; narrow windows give it less room.
    const pw = this.panelOpen ? Math.min(PANEL_WIDTH, Math.max(300, Math.round(w * 0.42))) : 0;
    const t = this.tabs.get(this.activeId);
    if (t && t.view) t.view.setBounds({ x: 0, y: top, width: Math.max(0, w - pw), height: Math.max(0, h - top) });
    if (this.panel && this.panelOpen) this.panel.setBounds({ x: w - pw, y: top, width: pw, height: Math.max(0, h - top) });
  }

  tabState(t) {
    const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    return {
      id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading, sleeping: !wc,
      audible: wc ? wc.isCurrentlyAudible() : false,
      canBack: wc ? wc.navigationHistory.canGoBack() : false,
      canForward: wc ? wc.navigationHistory.canGoForward() : false,
      blocked: t.blocked,
      certError: /^https:/.test(t.url) && this.ctx.certBypass.has(hostOf(t.url)),
      pinned: !!t.pinned,
      muted: wc ? wc.isAudioMuted() : !!t.muted,
      zoom: wc && !isInternal(t.url) ? Math.round(wc.getZoomFactor() * 100) : 100,
      bookmarked: /^https?:/.test(t.url) && this.ctx.library.isBookmarked(t.url),
    };
  }

  broadcast() {
    if (this.win.isDestroyed()) return;
    const ctx = this.ctx;
    const p = ctx.profile || { name: 'Profile', color: COLORS[0] };
    const active = ctx.downloads.filter((d) => d.state === 'progressing');
    const total = active.reduce((a, d) => a + (d.total || 0), 0);
    const got = active.reduce((a, d) => a + (d.received || 0), 0);
    this.send('state', {
      tabs: this.order.map((id) => this.tabState(this.tabs.get(id))),
      activeId: this.activeId,
      settings: {
        summaryMode: ctx.settings.summaryMode,
        showHomeButton: ctx.settings.showHomeButton,
        themeColor: ctx.settings.themeColor,
        toolbarSummary: ctx.settings.toolbarSummary,
        toolbarShield: ctx.settings.toolbarShield,
        searchEngine: ctx.settings.searchEngine,
        engineName: ENGINES[ctx.settings.searchEngine].name,
        bookmarksBar: !!ctx.settings.bookmarksBar,
        showAiButton: ctx.settings.showAiButton !== false,
        inlineAutocomplete: ctx.settings.inlineAutocomplete !== false,
        defaultZoom: Math.round((Number(ctx.settings.defaultZoom) || 1) * 100),
      },
      palette: ctx.palette(),
      private: ctx.isPrivate,
      ai: (() => { const st = ctx.ai.state(); return { active: st.active, name: st.activeName }; })(),
      panel: { open: this.panelOpen, mode: this.panelMode },
      bookmarks: ctx.settings.bookmarksBar ? ctx.library.listBookmarks().slice(0, 60).map((b) => ({ id: b.id, title: b.title, url: b.url, favicon: b.favicon })) : [],
      blockedTotal: ctx.blockedTotal,
      profile: { id: ctx.id, name: p.name, color: p.color, count: profiles.list().length },
      partition: ctx.partition,
      downloads: { count: ctx.downloads.length, active: active.length, progress: total ? got / total : null },
      extensions: !!ctx.extensions,
      extensionCount: ctx.session.extensions ? ctx.session.extensions.getAllExtensions().length : 0,
    });
  }

  // ----- tabs -----
  _attachView(t, url) {
    const ctx = this.ctx;
    const view = new WebContentsView({
      webPreferences: {
        session: ctx.session,
        preload: path.join(__dirname, 'tab-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        safeDialogs: true,
      },
    });
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0a0b0e' : '#fbfbfd');
    t.view = view;
    const wc = view.webContents;
    wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
    if (t.muted) wc.setAudioMuted(true);
    if (ctx.extensions) ctx.extensions.addTab(wc, this.win);

    wc.on('page-title-updated', (_e, title) => {
      t.title = title || t.url;
      if (!ctx.isPrivate && /^https?:/.test(t.url)) ctx.library.setTitle(t.url, title);
      if (t.id === this.activeId) this.panelSendTab();
      this.broadcast();
    });
    // Ctrl/Cmd + mouse wheel or trackpad pinch zooms the page, as in Chrome.
    wc.on('zoom-changed', (_e, dir) => {
      const level = wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5);
      wc.setZoomLevel(Math.max(-3, Math.min(5, level)));
      this.broadcast();
    });
    wc.on('page-favicon-updated', (_e, icons) => { t.favicon = icons[0] || ''; this.broadcast(); });
    wc.on('did-start-loading', () => { t.loading = true; this.broadcast(); });
    wc.on('focus', () => { if (this.suggestItems && this.suggestItems.length) { this.hideSuggestions(); this.send('omnibox-done'); } });
    wc.on('did-stop-loading', () => { t.loading = false; this.broadcast(); });
    wc.on('media-started-playing', () => this.broadcast());
    wc.on('media-paused', () => this.broadcast());
    wc.on('found-in-page', (_e, r) => this.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }));
    wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) { t.blocked = 0; t.favicon = ''; } });
    const onNav = (_e, navUrl) => {
      if (navUrl !== t.url) {
        const q = searchQueryOf(navUrl);
        if (q) ctx.rememberSearch(q);
        // History: every page you open, in normal windows only, unless it's turned off.
        if (!ctx.isPrivate && ctx.settings.saveHistory !== false && /^https?:/.test(navUrl)) ctx.library.visit(navUrl, wc.getTitle());
      }
      t.url = navUrl;
      if (t.id === this.activeId) this.panelSendTab();
      if (isInternal(navUrl)) t.favicon = '';
      const z = Number(ctx.settings.defaultZoom) || 1;
      if (!isInternal(navUrl) && z !== 1 && Math.abs(wc.getZoomFactor() - 1) < 0.01) wc.setZoomFactor(z);
      this.broadcast();
    };
    wc.on('did-navigate', onNav);
    wc.on('did-navigate-in-page', (e, navUrl, isMain) => { if (isMain) onNav(e, navUrl); });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
      // Certificate problems get a full warning page instead of a blank failure.
      if (isMain && code <= -200 && code > -300 && /^https:/.test(failedUrl) && !ctx.certBypass.has(hostOf(failedUrl))) {
        setImmediate(() => { if (!wc.isDestroyed()) wc.loadURL(warningUrl('cert', failedUrl, `&code=${encodeURIComponent(desc || code)}`)); });
        return;
      }
      // An HTTPS upgrade that fails falls back to plain HTTP once for that host.
      if (!isMain || !ctx.settings.httpsOnly) return;
      if (failedUrl.startsWith('https://') && t.upgradedFrom && hostOf(t.upgradedFrom) === hostOf(failedUrl) && code <= -100 && code > -300) {
        ctx.privacy.noteFailedUpgrade(t.upgradedFrom);
        wc.loadURL(t.upgradedFrom);
        t.upgradedFrom = null;
      }
    });
    wc.on('render-process-gone', (_e, details) => {
      if (TEST_SHOT_DIR) fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] render-process-gone ${details.reason} ${t.url.slice(0, 40)}\n`);
      if (details.reason === 'clean-exit') return;
      const crashedUrl = t.url;
      if (isInternal(crashedUrl)) return;
      setTimeout(() => {
        if (wc.isDestroyed()) return;
        wc.loadURL(warningUrl('crash', crashedUrl, `&code=${encodeURIComponent(details.reason)}`))
          .catch((err) => { if (TEST_SHOT_DIR) fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] crash page load failed ${err.message}\n`); });
      }, 50);
    });
    wc.setWindowOpenHandler(({ url: openUrl, disposition, features }) => {
      // A sized pop-up (window.open with features) is usually a sign-in flow such as "Sign in with
      // Google": it must stay a real pop-up that can talk back to the page that opened it.
      if (disposition === 'new-window' && /^https?:/i.test(openUrl)) {
        const f = Object.fromEntries(String(features || '').split(',').map((kv) => kv.split('=').map((x) => x.trim())));
        const width = Math.min(1200, Math.max(320, Number(f.width) || 520));
        const height = Math.min(1000, Math.max(320, Number(f.height) || 640));
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width, height, minWidth: 320, minHeight: 240, autoHideMenuBar: true, show: true,
            backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#ffffff',
            webPreferences: { preload: path.join(__dirname, 'tab-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      this.createTab(openUrl, { index: this.order.indexOf(t.id) + 1, activate: disposition !== 'background-tab' });
      return { action: 'deny' };
    });
    wc.on('did-create-window', (popup) => {
      // Pop-ups show where they really are in the title bar, so a fake sign-in page can't hide its address.
      const label = () => {
        if (popup.isDestroyed()) return;
        const u = popup.webContents.getURL();
        let host = '';
        try { host = new URL(u).host; } catch {}
        const lock = /^https:/.test(u) ? '🔒 ' : '⚠︎ ';
        popup.setTitle(`${lock}${host}${popup.webContents.getTitle() ? ' — ' + popup.webContents.getTitle() : ''}`);
      };
      popup.webContents.on('page-title-updated', (e) => { e.preventDefault(); label(); });
      popup.webContents.on('did-navigate', label);
      popup.webContents.setWindowOpenHandler(({ url: u2 }) => { this.createTab(u2); return { action: 'deny' }; });
      label();
    });
    wc.on('context-menu', (_e, p) => this.showContextMenu(t, p));
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (IS_MAC ? input.meta : input.control) && input.key.toLowerCase() === 'f' && !input.shift && !input.alt) {
        e.preventDefault();
        this.win.webContents.focus();
        this.send('find');
        return;
      }
      this.handleShortcut(e, input);
    });
    wc.loadURL(url);
  }

  createTab(url = NEWTAB_URL, { activate = true, index, pinned = false, muted = false } = {}) {
    const t = { id: this.nextId++, view: null, title: 'New Tab', url, favicon: '', loading: false, blocked: 0, lastActive: Date.now(), pinned: !!pinned, muted: !!muted };
    this.tabs.set(t.id, t);
    const pinnedCount = this.order.filter((id) => this.tabs.get(id) && this.tabs.get(id).pinned).length;
    if (pinned) index = index === undefined ? pinnedCount : Math.min(index, pinnedCount);
    else if (index !== undefined) index = Math.max(index, pinnedCount);
    if (index === undefined) this.order.push(t.id); else this.order.splice(index, 0, t.id);
    this._attachView(t, url);
    if (activate) this.activateTab(t.id); else this.broadcast();
    return t;
  }

  activateTab(id) {
    const t = this.tabs.get(id);
    if (!t || this.win.isDestroyed()) return;
    if (!t.view || t.view.webContents.isDestroyed()) this._attachView(t, t.url); // wake a sleeping tab
    for (const other of this.tabs.values()) {
      if (other.id !== id && other.view && this.win.contentView.children.includes(other.view)) this.win.contentView.removeChildView(other.view);
    }
    if (!this.win.contentView.children.includes(t.view)) this.win.contentView.addChildView(t.view);
    this.hideSuggestions();
    const prev = this.tabs.get(this.activeId);
    if (prev) prev.lastActive = Date.now();
    this.activeId = id;
    t.lastActive = Date.now();
    this.layout();
    if (this.ctx.extensions) this.ctx.extensions.selectTab(t.view.webContents);
    if (t.url === NEWTAB_URL) this.send('focus-omnibox');
    else t.view.webContents.focus();
    this.panelSendTab();
    this.broadcast();
  }

  closeTab(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    const idx = this.order.indexOf(id);
    if (t.url && t.url !== NEWTAB_URL) {
      this.closed.push({ url: t.view && !t.view.webContents.isDestroyed() ? (t.view.webContents.getURL() || t.url) : t.url, title: t.title, index: idx, pinned: !!t.pinned });
      if (this.closed.length > 25) this.closed.shift();
    }
    this.order = this.order.filter((x) => x !== id);
    this.tabs.delete(id);
    if (t.view) {
      if (this.win.contentView.children.includes(t.view)) this.win.contentView.removeChildView(t.view);
      if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    }
    if (!this.order.length) { this.win.close(); return; }
    if (this.activeId === id) this.activateTab(this.order[Math.min(idx, this.order.length - 1)]);
    else this.broadcast();
  }

  reopenClosed() {
    const c = this.closed.pop();
    if (!c) return null;
    return this.createTab(c.url, { index: Math.min(c.index, this.order.length), pinned: c.pinned });
  }

  setPinned(id, on) {
    const t = this.tabs.get(id);
    if (!t) return;
    t.pinned = !!on;
    this.order = this.order.filter((x) => x !== id);
    const pinnedCount = this.order.filter((x) => this.tabs.get(x).pinned).length;
    this.order.splice(pinnedCount, 0, id);
    this.broadcast();
  }
  // Keeps pinned tabs together at the start after a drag.
  settleOrder() {
    this.order = [...this.order.filter((x) => this.tabs.get(x).pinned), ...this.order.filter((x) => !this.tabs.get(x).pinned)];
  }

  toggleMute(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    t.muted = !(wc ? wc.isAudioMuted() : t.muted);
    if (wc) wc.setAudioMuted(t.muted);
    this.broadcast();
  }

  toggleBookmark(id = this.activeId) {
    const t = this.tabs.get(id);
    if (!t || !/^https?:/.test(t.url)) return false;
    const lib = this.ctx.library;
    let added = false;
    if (lib.isBookmarked(t.url)) lib.removeBookmark(t.url);
    else { lib.addBookmark({ url: t.url, title: t.title, favicon: t.favicon }); added = true; }
    for (const w of windows) w.broadcast();
    return added;
  }

  zoom(dir) {
    const wc = this.activeWc();
    if (!wc) return;
    if (dir === 0) wc.setZoomFactor(Number(this.ctx.settings.defaultZoom) || 1);
    else wc.setZoomLevel(Math.max(-3, Math.min(5, wc.getZoomLevel() + (dir > 0 ? 0.5 : -0.5))));
    this.broadcast();
  }

  // ---------- side panel: AI, reading mode, share ----------
  ensurePanel() {
    if (this.panel && !this.panel.webContents.isDestroyed()) return this.panel;
    const v = new WebContentsView({
      webPreferences: {
        session: this.ctx.session,
        preload: path.join(__dirname, 'tab-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    v.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111317' : '#fbfbfd');
    const wc = v.webContents;
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url) || url.startsWith(INTERNAL)) this.createTab(url, { index: this.order.indexOf(this.activeId) + 1 }); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => {
      if (url.startsWith(PANEL_URL)) return;
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) this.createTab(url, { index: this.order.indexOf(this.activeId) + 1 });
    });
    wc.on('before-input-event', (e, input) => this.handleShortcut(e, input));
    this.panelReady = false;
    wc.on('did-start-loading', () => { this.panelReady = false; });
    wc.on('did-finish-load', () => {
      this.panelReady = true;
      this.panelSendTab();
      for (const m of this.panelQueue.splice(0)) wc.send('lantern:panel', m);
    });
    wc.loadURL(PANEL_URL);
    this.panel = v;
    return v;
  }
  openPanel(mode, extra = {}) {
    if (mode) this.panelMode = mode;
    const v = this.ensurePanel();
    if (!this.panelOpen) {
      this.panelOpen = true;
      this.win.contentView.addChildView(v);
    }
    this.layout();
    this.panelSend({ type: 'mode', mode: this.panelMode, ...extra });
    v.webContents.focus();
    this.broadcast();
  }
  closePanel() {
    this.panelOpen = false;
    if (this.panel && this.win.contentView.children.includes(this.panel)) this.win.contentView.removeChildView(this.panel);
    this.layout();
    const wc = this.activeWc();
    if (wc) wc.focus();
    this.broadcast();
  }
  togglePanel(mode) {
    if (this.panelOpen && (!mode || mode === this.panelMode)) this.closePanel();
    else this.openPanel(mode || this.panelMode || 'ai');
  }
  panelSend(msg) {
    if (!this.panel || this.panel.webContents.isDestroyed()) return;
    const wc = this.panel.webContents;
    if (!this.panelReady) this.panelQueue.push(msg);
    else wc.send('lantern:panel', msg);
  }
  panelSendTab() {
    if (!this.panel) return;
    const t = this.activeTab();
    this.panelSend({ type: 'tab', tab: t ? { id: t.id, title: tabTitle(t), url: t.url, web: /^https?:/.test(t.url) } : null });
  }

  showTabMenu(id, x, y) {
    const t = this.tabs.get(id);
    if (!t) return;
    const idx = this.order.indexOf(id);
    const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    const web = /^https?:/.test(t.url);
    const muted = wc ? wc.isAudioMuted() : !!t.muted;
    const marked = web && this.ctx.library.isBookmarked(t.url);
    const template = [
      { label: 'New tab to the right', click: () => this.createTab(NEWTAB_URL, { index: idx + 1 }) },
      { type: 'separator' },
      { label: 'Reload', click: () => (wc ? wc.reload() : this.activateTab(id)) },
      { label: 'Duplicate', click: () => this.createTab(t.url, { index: idx + 1, pinned: t.pinned }) },
      { label: t.pinned ? 'Unpin' : 'Pin', click: () => this.setPinned(id, !t.pinned) },
      { label: muted ? 'Unmute site' : 'Mute site', click: () => this.toggleMute(id) },
      { type: 'separator' },
      { label: marked ? 'Remove bookmark' : 'Bookmark this tab', enabled: web, click: () => this.toggleBookmark(id) },
      { label: 'Copy link', enabled: web, click: () => clipboard.writeText(t.url) },
      { label: 'Ask AI about this tab', enabled: web, click: () => { this.activateTab(id); this.openPanel('ai', { prompt: 'Summarize this page in a few key points.', send: true }); } },
      { type: 'separator' },
      { label: 'Close', click: () => this.closeTab(id) },
      { label: 'Close other tabs', enabled: this.order.some((x) => x !== id && !this.tabs.get(x).pinned), click: () => this.order.filter((x) => x !== id && !this.tabs.get(x).pinned).forEach((x) => this.closeTab(x)) },
      { label: 'Close tabs to the right', enabled: idx < this.order.length - 1, click: () => this.order.slice(idx + 1).forEach((x) => this.closeTab(x)) },
      { type: 'separator' },
      { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: this.closed.length > 0, click: () => this.reopenClosed() },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  showBookmarkMenu(id, x, y) {
    const b = this.ctx.library.listBookmarks().find((x2) => x2.id === id);
    if (!b) return;
    const template = [
      { label: 'Open in new tab', click: () => this.createTab(b.url, { activate: false, index: this.order.indexOf(this.activeId) + 1 }) },
      { label: 'Open in new window', click: () => openWindow(this.ctx, { urls: [b.url] }) },
      ...(this.ctx.isPrivate ? [] : [{ label: 'Open in private window', click: () => openPrivateWindow(this.ctx, [b.url]) }]),
      { type: 'separator' },
      { label: 'Edit…', click: () => openLibrary(this, 'bookmarks', b.id) },
      { label: 'Copy link', click: () => clipboard.writeText(b.url) },
      { label: 'Delete', click: () => { this.ctx.library.removeBookmark(b.id); for (const w of windows) w.broadcast(); } },
      { type: 'separator' },
      { label: 'Bookmark manager', click: () => openLibrary(this, 'bookmarks') },
      { label: 'Hide bookmarks bar', click: () => setBookmarksBar(this.ctx, false) },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // Memory saver: idle background tabs give their memory back and reload when you return.
  sleepIdleTabs() {
    if (!this.ctx.settings.memorySaver) return;
    const now = Date.now();
    for (const t of this.tabs.values()) {
      if (t.id === this.activeId || !t.view || t.view.webContents.isDestroyed()) continue;
      const wc = t.view.webContents;
      if (now - t.lastActive < SLEEP_AFTER_MS || wc.isCurrentlyAudible() || wc.isLoading() || isInternal(t.url)) continue;
      t.url = wc.getURL() || t.url;
      wc.close();
      t.view = null;
    }
    this.broadcast();
  }

  // ---------- omnibox suggestions popup ----------
  // Chrome draws its suggestion list in a popup over the page. Lantern does the same with a small
  // view stacked above the active tab, so the list can drop down over the page content.
  ensureSuggestView() {
    if (this.suggestView && !this.suggestView.webContents.isDestroyed()) return this.suggestView;
    const v = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'suggest-preload.js'), partition: UI_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    v.setBackgroundColor('#00000000');
    v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    v.webContents.on('will-navigate', (e) => e.preventDefault());
    v.webContents.loadFile(path.join(__dirname, 'ui', 'suggest.html'));
    this.suggestView = v;
    return v;
  }
  showSuggestions(items, selected, rect, query) {
    if (this.win.isDestroyed()) return;
    this.suggestItems = Array.isArray(items) ? items : [];
    if (!this.suggestItems.length) { this.hideSuggestions(); return; }
    const v = this.ensureSuggestView();
    const [cw] = this.win.getContentSize();
    const pad = 10; // room for the shadow
    const x = Math.max(0, Math.round(Number(rect && rect.x) || 0) - pad);
    const width = Math.min(cw - x, Math.round(Number(rect && rect.width) || 600) + pad * 2);
    const head = !query && this.suggestItems.every((x) => x.type === 'recent') ? 26 : 0;
    const height = 14 + head + this.suggestItems.length * 40 + pad * 2;
    const top = Math.min(UI_HEIGHT, Math.round(Number(rect && rect.bottom) || UI_HEIGHT - 4)); // popup hangs from the omnibox
    v.setBounds({ x, y: top - pad, width, height });
    const send = () => v.webContents.send('suggest:render', { items: this.suggestItems, selected, query: String(query || ''), dark: nativeTheme.shouldUseDarkColors, accent: rect && rect.accent });
    if (v.webContents.isLoading()) v.webContents.once('did-finish-load', send); else send();
    const kids = this.win.contentView.children;
    if (kids[kids.length - 1] !== v) this.win.contentView.addChildView(v); // (re)adding puts it on top
  }
  hideSuggestions() {
    this.suggestItems = [];
    if (this.suggestView && this.win.contentView.children.includes(this.suggestView)) this.win.contentView.removeChildView(this.suggestView);
  }
  pickSuggestion(index, { summary = false } = {}) {
    const item = (this.suggestItems || [])[index];
    this.hideSuggestions();
    this.send('omnibox-done');
    if (!item) return;
    if (item.type === 'tab') { if (this.tabs.has(item.id)) this.activateTab(item.id); return; }
    if (item.type === 'ai') { this.openPanel('ai', { prompt: item.text, send: true }); return; }
    const wc = this.activeWc();
    if (!wc) return;
    const url = item.url && /^(https?|lantern):/i.test(item.url) ? item.url : searchUrl(this.ctx, item.text, summary);
    wc.loadURL(url);
    wc.focus();
  }

  activeTab() { return this.tabs.get(this.activeId); }
  activeWc() {
    const t = this.activeTab();
    return t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
  }

  cycleTab(dir) {
    const i = this.order.indexOf(this.activeId);
    this.activateTab(this.order[(i + dir + this.order.length) % this.order.length]);
  }
  handleShortcut(e, input) {
    if (input.type !== 'keyDown') return;
    const mod = IS_MAC ? input.meta : input.control;
    if (input.control && input.key === 'Tab') { e.preventDefault(); this.cycleTab(input.shift ? -1 : 1); }
    if (mod && /^[1-9]$/.test(input.key)) {
      e.preventDefault();
      const n = Number(input.key);
      this.activateTab(n === 9 ? this.order[this.order.length - 1] : this.order[n - 1] ?? this.activeId);
    }
  }

  showContextMenu(t, p) {
    const wc = t.view.webContents;
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: 'Open link in new tab', click: () => this.createTab(p.linkURL, { activate: false, index: this.order.indexOf(t.id) + 1 }) },
        { label: 'Open link in new window', click: () => openWindow(this.ctx, { urls: [p.linkURL] }) },
        ...(/^https?:/i.test(p.linkURL) && !this.ctx.isPrivate ? [{ label: 'Open link in private window', click: () => openPrivateWindow(this.ctx, [p.linkURL]) }] : []),
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.selectionText && p.selectionText.trim()) {
      const sel = p.selectionText.trim().slice(0, 200);
      const short = sel.length > 28 ? sel.slice(0, 28) + '…' : sel;
      items.push(
        { label: 'Copy', role: 'copy' },
        { label: `Summarize “${short}”`, click: () => this.createTab(searchUrl(this.ctx, sel, true), { index: this.order.indexOf(t.id) + 1 }) },
        { label: `Search ${ENGINES[this.ctx.settings.searchEngine].name} for “${short}”`, click: () => this.createTab(searchUrl(this.ctx, sel), { index: this.order.indexOf(t.id) + 1 }) },
        { label: `Ask ${this.ctx.ai.state().activeName || 'AI'} about “${short}”`, click: () => this.openPanel('ai', { prompt: 'Explain the selected text.', selection: p.selectionText.trim().slice(0, 4000), send: !!this.ctx.ai.state().active }) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Open image in new tab', click: () => this.createTab(p.srcURL, { activate: false }) },
        { label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) },
        { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
    }
    if (this.ctx.extensions) {
      const extItems = this.ctx.extensions.getContextMenuItems(wc, p);
      if (extItems.length) items.push(...extItems, { type: 'separator' });
    }
    const web = /^https?:/.test(t.url);
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      ...(web && !p.isEditable && !p.selectionText ? [
        { label: this.ctx.library.isBookmarked(t.url) ? 'Remove bookmark' : 'Bookmark this page', click: () => this.toggleBookmark(t.id) },
        { label: 'Summarize page with AI', click: () => this.openPanel('ai', { prompt: 'Summarize this page in a few key points.', send: !!this.ctx.ai.state().active }) },
        { label: 'Reading mode', click: () => this.openPanel('reader') },
        { label: 'Print…', click: () => wc.print() },
        { type: 'separator' },
      ] : []),
      { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) },
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }
}

function openWindow(ctx, opts = {}) {
  const w = new WindowController(ctx, opts);
  profiles.setLastUsed(ctx.id);
  return w;
}
function findTabByWebContentsId(wcId, withWindow = false) {
  for (const w of windows) {
    for (const t of w.tabs.values()) {
      if (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) return withWindow ? { win: w, tab: t } : t;
    }
  }
  return null;
}
function windowForUiSender(sender) {
  for (const w of windows) if (!w.win.isDestroyed() && w.win.webContents === sender) return w;
  return null;
}

// ---------- search URLs ----------
const SEARCH_HOSTS = [/(^|\.)duckduckgo\.com$/, /(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /^search\.brave\.com$/, /(^|\.)startpage\.com$/, /(^|\.)ecosia\.org$/];
function searchQueryOf(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const q = u.searchParams.get('q') || '';
  if (u.protocol === 'lantern:') return u.host === 'app' && u.pathname === '/search.html' ? q : '';
  if (!/^https?:$/.test(u.protocol) || !SEARCH_HOSTS.some((re) => re.test(u.hostname))) return '';
  return /^\/(search|do\/search)?$/.test(u.pathname) ? q : '';
}
function looksLikeUrl(text) {
  return /^(https?|lantern|file):\/\//i.test(text)
    || (/^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(text) && !/\s/.test(text));
}
// What the omnibox and Lantern's search boxes offer as you type: what you typed, matching open tabs
// and shortcuts, your recent searches, then suggestions from the search provider.
async function suggestionsFor(ctx, w, input, { remote = false, tabs = true } = {}) {
  const text = String(input || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const low = text.toLowerCase();
  const out = [];
  const seen = new Set();
  const add = (item) => {
    const k = item.type + '|' + (item.url || item.text).toLowerCase();
    const kq = 'q|' + item.text.toLowerCase();
    if (seen.has(k) || ((item.type === 'search' || item.type === 'recent') && seen.has(kq))) return;
    seen.add(k);
    if (item.type === 'search' || item.type === 'recent') seen.add(kq);
    out.push(item);
  };
  if (!text) {
    ctx.recentSearches.slice(0, 6).forEach((q) => add({ type: 'recent', text: q }));
    return out;
  }
  if (looksLikeUrl(text)) add({ type: 'url', text, url: toUrl(ctx, text) });
  else add({ type: 'search', text, typed: true });
  if (tabs && w) {
    for (const id of w.order) {
      const t = w.tabs.get(id);
      if (!t || id === w.activeId || isInternal(t.url)) continue;
      if ((t.title || '').toLowerCase().includes(low) || (t.url || '').toLowerCase().includes(low)) add({ type: 'tab', id, text: t.title || hostOf(t.url), sub: hostOf(t.url) });
      if (out.filter((x) => x.type === 'tab').length >= 2) break;
    }
  }
  for (const sc of ctx.settings.shortcuts || []) {
    if (sc.title.toLowerCase().includes(low) || hostOf(sc.url).includes(low)) add({ type: 'url', text: sc.title, sub: hostOf(sc.url), url: sc.url });
  }
  // Pages from history and bookmarks, ranked by the Rust core. The best one can complete inline.
  let inlineGiven = false;
  for (const h of w ? ctx.library.suggest(text, 4) : []) {
    if (out.some((x) => x.url === h.url)) continue;
    const item = { type: h.bookmark ? 'bookmark' : 'history', text: h.title && h.title !== h.url ? h.title : displayUrl(h.url), sub: displayUrl(h.url), url: h.url };
    if (h.inline && !inlineGiven && ctx.settings.inlineAutocomplete !== false) { item.inline = h.inline; inlineGiven = true; }
    add(item);
    if (out.length >= 6) break;
  }
  const aiState = ctx.ai.state();
  const aiItem = w && aiState.active && !looksLikeUrl(text) && text.length > 2 ? { type: 'ai', text, sub: `Ask ${aiState.activeName}` } : null;
  ctx.recentSearches.filter((q) => q.toLowerCase().startsWith(low) && q.toLowerCase() !== low).slice(0, 3)
    .forEach((q) => add({ type: 'recent', text: q }));
  const room = aiItem ? 7 : 8;
  if (remote && ctx.settings.searchSuggestions !== false && !looksLikeUrl(text)) {
    for (const q of await suggest(text, { fetch: fetchImpl() })) {
      if (out.length >= room) break;
      add({ type: 'search', text: q });
    }
  }
  const list = out.slice(0, room);
  if (aiItem) list.push(aiItem);
  return list;
}

function searchUrl(ctx, text, forceSummary = false) {
  const q = encodeURIComponent(text);
  if (forceSummary) return `${INTERNAL}search.html?q=${q}&summary=1`;
  return ENGINES[ctx.settings.searchEngine].url.replace('%s', q);
}
function toUrl(ctx, input, forceSummary) {
  const text = String(input || '').trim();
  if (!text) return NEWTAB_URL;
  if (/^(https?|lantern|file):\/\//i.test(text)) return text;
  if (/^about:blank$/i.test(text)) return text;
  if (/^(settings|lantern:settings)$/i.test(text)) return SETTINGS_URL;
  const looksLikeHost = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(text) && !/\s/.test(text);
  if (looksLikeHost) return (/^(localhost|127\.|\d)/.test(text) ? 'http://' : 'https://') + text;
  return searchUrl(ctx, text, forceSummary);
}

// ---------- menus ----------
function overlayColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#1b1d21', symbolColor: '#e8eaed', height: 40 }
    : { color: '#e3e6ea', symbolColor: '#1f2328', height: 40 };
}
function focusedController() {
  const f = BrowserWindow.getFocusedWindow();
  return [...windows].find((w) => w.win === f) || [...windows][0] || null;
}
function openSettings(w, section = '') {
  w = w || focusedController();
  if (!w) return;
  const url = SETTINGS_URL + (section ? '#' + section : '');
  const existing = [...w.tabs.values()].find((t) => t.url.startsWith(SETTINGS_URL));
  if (existing) { w.activateTab(existing.id); if (existing.view) existing.view.webContents.loadURL(url); }
  else w.createTab(url);
}
// History, bookmarks and downloads live on one page, like Chrome's chrome://history and friends.
function openLibrary(w, section = 'history', focus = '') {
  w = w || focusedController();
  if (!w) return;
  const url = LIBRARY_URL + '#' + section + (focus ? '/' + encodeURIComponent(focus) : '');
  const existing = [...w.tabs.values()].find((t) => t.url.startsWith(LIBRARY_URL));
  if (existing) { w.activateTab(existing.id); if (existing.view) existing.view.webContents.loadURL(url); }
  else w.createTab(url);
}
function setBookmarksBar(ctx, on) {
  const base = ctx.isPrivate ? ctx.parent : ctx;
  for (const c of [base, ...[...contexts.values()].filter((x) => x.parent === base)]) {
    c.settings.bookmarksBar = !!on;
    c.saveSettings();
  }
  refreshAppMenu();
}
async function savePageAs(w) {
  const wc = w && w.activeWc();
  if (!wc) return;
  const name = (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const r = await dialog.showSaveDialog(w.win, {
    defaultPath: path.join(w.ctx.settings.downloadsDir || app.getPath('downloads'), `${name}.html`),
    filters: [{ name: 'Web page, complete', extensions: ['html'] }, { name: 'Web page, HTML only', extensions: ['htm'] }],
  });
  if (r.canceled || !r.filePath) return;
  try { await wc.savePage(r.filePath, r.filePath.endsWith('.htm') ? 'HTMLOnly' : 'HTMLComplete'); } catch (err) {
    dialog.showMessageBox(w.win, { type: 'warning', message: 'Lantern couldn\'t save this page', detail: err.message });
  }
}
async function clearBrowsingData(ctx, what = { cookies: true, cache: true, history: true }) {
  if (what.cookies) await ctx.session.clearStorageData();
  if (what.cache) { await ctx.session.clearCache(); await ctx.session.clearAuthCache(); }
  if (what.history) {
    for (const w of ctx.windows()) for (const t of w.tabs.values()) if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.navigationHistory.clear();
    if (ctx.sessionFile) { try { fs.rmSync(ctx.sessionFile, { force: true }); } catch {} }
    ctx.clearSearches();
    if (!ctx.isPrivate) ctx.library.clearHistory();
    for (const w of ctx.windows()) w.closed = [];
  }
  ctx.broadcast();
}

function profileMenuItems(current) {
  return [
    ...profiles.list().filter((p) => p.id !== current.id).map((p) => ({ label: `Open ${p.name}`, click: () => openProfile(p.id) })),
    { label: 'Add profile…', click: () => { const p = profiles.create({}); openProfile(p.id, { section: 'you' }); } },
    { label: 'Manage profiles', click: () => openSettings(null, 'you') },
  ];
}
function openProfile(id, { section } = {}) {
  const ctx = getContext(id);
  const existing = ctx.windows()[0];
  if (existing) { existing.win.focus(); if (section) openSettings(existing, section); return existing; }
  const w = openWindow(ctx, { urls: section ? [SETTINGS_URL + '#' + section] : [] });
  return w;
}

function appMenuTemplate() {
  const w = () => focusedController();
  const wc = () => w() && w().activeWc();
  const base = () => (w() ? w().ctx : getContext(profiles.lastUsed().id));
  const barOn = !!(w() && w().ctx.settings.bookmarksBar);
  const recent = w() ? w().closed.slice(-8).reverse() : [];
  const marks = w() ? w().ctx.library.listBookmarks().slice(0, 30) : [];
  return [
    ...(IS_MAC ? [{
      label: 'Lantern',
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => openSettings() },
        { label: 'Extensions', click: () => openSettings(null, 'extensions') },
        { label: 'AI keys…', click: () => w() && w().openPanel('ai', { view: 'keys' }) },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => (w() ? w().createTab() : openWindow(getContext(profiles.lastUsed().id))) },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => openWindow(w() && !w().ctx.isPrivate ? w().ctx : getContext(profiles.lastUsed().id)) },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => openPrivateWindow(base()) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: recent.length > 0, click: () => w() && w().reopenClosed() },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: () => w() && w().send('focus-omnibox') },
        { type: 'separator' },
        { label: 'Save Page As…', accelerator: 'CmdOrCtrl+S', click: () => savePageAs(w()) },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => wc() && wc().print() },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { label: 'Settings', accelerator: 'Ctrl+,', click: () => openSettings() }]),
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => w() && w().closeTab(w().activeId) },
        IS_MAC ? { role: 'close', accelerator: 'Cmd+Shift+W' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }, { type: 'separator' },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => { const c = w(); if (c) { c.win.webContents.focus(); c.send('find'); } } }] },
    {
      label: 'View',
      submenu: [
        { label: 'Always Show Bookmarks Bar', type: 'checkbox', checked: barOn, accelerator: 'CmdOrCtrl+Shift+B', click: () => w() && setBookmarksBar(w().ctx, !barOn) },
        { label: 'AI Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => w() && w().togglePanel('ai') },
        { label: 'Reading Mode', click: () => w() && w().togglePanel('reader') },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => wc() && wc().reload() },
        { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => wc() && wc().reloadIgnoringCache() },
        { label: 'Back', accelerator: IS_MAC ? 'Cmd+[' : 'Alt+Left', click: () => wc() && wc().navigationHistory.goBack() },
        { label: 'Forward', accelerator: IS_MAC ? 'Cmd+]' : 'Alt+Right', click: () => wc() && wc().navigationHistory.goForward() },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => w() && w().zoom(1) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => w() && w().zoom(1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => w() && w().zoom(-1) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => w() && w().zoom(0) },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: IS_MAC ? 'Alt+Cmd+I' : 'F12', click: () => wc() && wc().toggleDevTools() },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Show Full History', accelerator: IS_MAC ? 'Cmd+Y' : 'Ctrl+H', click: () => openLibrary(w(), 'history') },
        { label: 'Downloads', accelerator: IS_MAC ? 'Cmd+Shift+J' : 'Ctrl+J', click: () => openLibrary(w(), 'downloads') },
        { type: 'separator' },
        { label: 'Recently Closed', enabled: false },
        ...recent.map((c) => ({ label: (c.title || c.url).slice(0, 60), click: () => { const ww = w(); if (!ww) return; const i = ww.closed.lastIndexOf(c); if (i >= 0) ww.closed.splice(i, 1); ww.createTab(c.url, { pinned: c.pinned }); } })),
        { type: 'separator' },
        { label: 'Clear Browsing Data…', accelerator: 'CmdOrCtrl+Shift+Backspace', click: () => openSettings(null, 'privacy') },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Tab', accelerator: 'CmdOrCtrl+D', click: () => w() && w().toggleBookmark() },
        { label: 'Bookmark Manager', accelerator: IS_MAC ? 'Alt+Cmd+B' : 'Ctrl+Shift+O', click: () => openLibrary(w(), 'bookmarks') },
        { type: 'separator' },
        ...marks.map((b) => ({ label: (b.title || b.url).slice(0, 60), click: () => { const ww = w(); if (ww) { const x = ww.activeWc(); if (x) x.loadURL(b.url); else ww.createTab(b.url); } } })),
      ],
    },
    {
      label: 'Profiles',
      submenu: w() ? profileMenuItems(w().ctx.profile || profiles.lastUsed()) : [],
    },
    { role: 'windowMenu' },
  ];
}
function refreshAppMenu() { Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate())); }

function showMainMenu(w, x, y) {
  const ctx = w.ctx;
  const wc = w.activeWc();
  const t = w.activeTab();
  const web = !!(t && /^https?:/.test(t.url));
  const zoom = wc && t && !isInternal(t.url) ? Math.round(wc.getZoomFactor() * 100) : 100;
  const template = [
    { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => w.createTab() },
    { label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => openWindow(ctx.isPrivate ? ctx.parent : ctx) },
    { label: 'New private window', accelerator: 'CmdOrCtrl+Shift+N', click: () => openPrivateWindow(ctx) },
    { type: 'separator' },
    { label: 'AI assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => w.openPanel('ai') },
    { label: 'Reading mode', enabled: web, click: () => w.openPanel('reader') },
    { label: 'Share this page', enabled: web, click: () => w.openPanel('share') },
    { type: 'separator' },
    { label: 'History', accelerator: IS_MAC ? 'Cmd+Y' : 'Ctrl+H', click: () => openLibrary(w, 'history') },
    { label: 'Bookmarks', submenu: [
      { label: t && web && ctx.library.isBookmarked(t.url) ? 'Remove bookmark' : 'Bookmark this tab', accelerator: 'CmdOrCtrl+D', enabled: web, click: () => w.toggleBookmark() },
      { label: ctx.settings.bookmarksBar ? 'Hide bookmarks bar' : 'Show bookmarks bar', accelerator: 'CmdOrCtrl+Shift+B', click: () => setBookmarksBar(ctx, !ctx.settings.bookmarksBar) },
      { label: 'Bookmark manager', click: () => openLibrary(w, 'bookmarks') },
    ] },
    { label: 'Downloads', accelerator: IS_MAC ? 'Cmd+Shift+J' : 'Ctrl+J', click: () => openLibrary(w, 'downloads') },
    { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: w.closed.length > 0, click: () => w.reopenClosed() },
    { label: 'Extensions', enabled: !ctx.isPrivate, submenu: [
      { label: 'Manage extensions', click: () => openSettings(w, 'extensions') },
      { label: 'Visit Chrome Web Store', click: () => w.createTab('https://chromewebstore.google.com/') },
    ] },
    { label: 'Customize Lantern', click: () => { const url = NEWTAB_URL + '#customize'; if (t && t.url.startsWith(NEWTAB_URL) && t.view) t.view.webContents.loadURL(url); else w.createTab(url); } },
    { label: 'Clear browsing data…', click: () => openSettings(w, 'privacy') },
    { type: 'separator' },
    { label: `Zoom  ${zoom}%`, enabled: false },
    { label: 'Zoom in', enabled: !!wc, accelerator: 'CmdOrCtrl+=', click: () => w.zoom(1) },
    { label: 'Zoom out', enabled: !!wc, accelerator: 'CmdOrCtrl+-', click: () => w.zoom(-1) },
    { label: 'Reset zoom', enabled: !!wc && zoom !== Math.round((Number(ctx.settings.defaultZoom) || 1) * 100), click: () => w.zoom(0) },
    { type: 'separator' },
    { label: 'Find on page…', enabled: !!wc, accelerator: 'CmdOrCtrl+F', click: () => { w.win.webContents.focus(); w.send('find'); } },
    { label: 'Print…', enabled: !!wc, accelerator: 'CmdOrCtrl+P', click: () => wc.print() },
    { label: 'Save page as…', enabled: web, accelerator: 'CmdOrCtrl+S', click: () => savePageAs(w) },
    { type: 'separator' },
    { label: 'Settings', accelerator: IS_MAC ? 'Cmd+,' : 'Ctrl+,', click: () => openSettings(w) },
    { label: 'Developer tools', enabled: !!wc, click: () => wc.toggleDevTools() },
    { type: 'separator' },
    { label: IS_MAC ? 'Quit Lantern' : 'Exit', click: () => app.quit() },
  ];
  Menu.buildFromTemplate(template).popup({ window: w.win, x: Math.round(x), y: Math.round(y) });
}
// The AI button's menu: switch between the services you've added keys for, or add another.
function showAiMenu(w, x, y) {
  const st = w.ctx.ai.state();
  const template = [
    { label: w.panelOpen && w.panelMode === 'ai' ? 'Hide AI assistant' : 'Open AI assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => w.togglePanel('ai') },
    { type: 'separator' },
    { label: 'Answer with', enabled: false },
    ...st.providers.map((p) => ({
      label: p.hasKey ? `${p.short}  ·  ${p.model}` : `${p.short}  (add a key)`,
      type: p.hasKey ? 'radio' : 'normal',
      checked: st.active === p.id,
      click: () => {
        if (!p.hasKey) { w.openPanel('ai', { view: 'keys', provider: p.id }); return; }
        w.ctx.ai.setActive(p.id);
        broadcastAll();
        w.panelSend({ type: 'ai-state' });
      },
    })),
    { type: 'separator' },
    { label: 'Manage API keys…', click: () => w.openPanel('ai', { view: 'keys' }) },
  ];
  Menu.buildFromTemplate(template).popup({ window: w.win, x: Math.round(x), y: Math.round(y) });
}
function showProfileMenu(w, x, y) {
  const p = w.ctx.profile || profiles.lastUsed();
  const template = [
    { label: p.name, enabled: false },
    { type: 'separator' },
    ...profileMenuItems(p),
  ];
  Menu.buildFromTemplate(template).popup({ window: w.win, x: Math.round(x), y: Math.round(y) });
}
function showDownloadsMenu(w, x, y) {
  const items = w.ctx.downloads.slice(0, 10).map((d) => {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : null;
    const status = d.state === 'completed' ? '' : d.state === 'progressing' ? ` — ${pct === null ? 'downloading' : pct + '%'}` : ` — ${d.state}`;
    return {
      label: d.name + status,
      enabled: d.state === 'completed',
      submenu: d.state === 'completed' ? [
        { label: 'Open', click: () => shell.openPath(d.path) },
        { label: IS_MAC ? 'Show in Finder' : 'Show in folder', click: () => shell.showItemInFolder(d.path) },
      ] : undefined,
    };
  });
  items.push({ type: 'separator' }, { label: 'Open downloads folder', click: () => shell.openPath(w.ctx.settings.downloadsDir || app.getPath('downloads')) });
  Menu.buildFromTemplate(items).popup({ window: w.win, x: Math.round(x), y: Math.round(y) });
}

// ---------- internal pages ----------
const servedSessions = new WeakSet();
function serveInternal(ses, ctx) {
  if (servedSessions.has(ses)) return;
  servedSessions.add(ses);
  ses.protocol.handle('lantern', (request) => {
    const u = new URL(request.url);
    if (u.host !== 'app') return new Response('Not found', { status: 404 });
    if (u.pathname === '/user/background') {
      // The profile's own new tab background image, chosen in Customize Lantern.
      const file = ctx && ctx.backgroundFile();
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'newtab.html';
    const file = path.normalize(path.join(PAGES_DIR, rel));
    if (!file.startsWith(PAGES_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Every handler validates its sender explicitly (REA's audit of 1.0 found no visible sender checks).
function internalContext(event) {
  const frameUrl = event.senderFrame && event.senderFrame.url;
  if (!frameUrl || !frameUrl.startsWith(INTERNAL)) throw new Error('Not allowed');
  for (const ctx of contexts.values()) if (event.sender.session === ctx.session) return ctx;
  throw new Error('Not allowed');
}
function handleInternal(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => fn(internalContext(event), event, ...args));
}

function fetchImpl() {
  return USE_FIXTURES ? require('../test/fixture-fetch').fixtureFetch : (u, o) => fetchSession.fetch(u, o);
}

handleInternal('lantern:search', (_ctx, _e, query, next, seen) => {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new Error('empty query');
  return search(q, { fetch: fetchImpl(), next: next && typeof next === 'object' ? next : null, seen: Array.isArray(seen) ? seen.slice(0, 200).map(String) : [] });
});
handleInternal('lantern:summary', (_ctx, event, query) => {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new Error('empty query');
  return buildSummary(q, {
    fetch: fetchImpl(),
    onProgress: (step) => { if (!event.sender.isDestroyed()) event.sender.send('lantern:progress', step); },
  });
});
handleInternal('lantern:suggest', (ctx, _e, text, remote) => suggestionsFor(ctx, null, text, { remote: !!remote, tabs: false }));
handleInternal('lantern:forget-search', (ctx, _e, text) => { ctx.forgetSearch(String(text || '')); return true; });
handleInternal('lantern:info', (ctx) => ({
  blockedTotal: ctx.blockedTotal,
  settings: ctx.settings,
  engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
  engineUrl: ENGINES[ctx.settings.searchEngine].url,
  profile: ctx.profile,
  profiles: profiles.list(),
  colors: COLORS,
  platform: process.platform,
  versions: { lantern: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
  downloadsDefault: app.getPath('downloads'),
  crashed: ctx.crashed && !!ctx.lastSession(),
  lastSessionTabs: (ctx.lastSession() || { windows: [] }).windows.reduce((a, w) => a + w.tabs.length, 0),
  extensionsAvailable: !!ctx.extensions,
  private: ctx.isPrivate,
  palette: ctx.palette(),
  mail: ctx.mail(),
  mailServices: core.mail.services(),
  ai: (() => { const st = ctx.ai.state(); return { active: st.active, name: st.activeName, configured: st.providers.filter((p) => p.hasKey).length }; })(),
  core: core.version(),
}));

// Every setting is checked by the Rust core before it's saved (rust/lantern-core/src/settings.rs).
handleInternal('lantern:set-setting', (ctx, _e, key, value) => {
  const r = core.settings.validate(String(key), value === undefined ? null : value);
  if (!r.ok) throw new Error(`Invalid setting: ${r.message}`);
  if (key === 'themeColor' && r.value === 'custom' && !ctx.settings.customAccent) ctx.settings.customAccent = '#3b82f6';
  ctx.settings[key] = r.value;
  if (key === 'customAccent') ctx.settings.themeColor = 'custom';
  if (key === 'rememberSearches' && !r.value) ctx.clearSearches();
  ctx.saveSettings();
  if (key === 'bookmarksBar' && !ctx.isPrivate) for (const c of contexts.values()) if (c.parent === ctx) { c.settings.bookmarksBar = r.value; c.saveSettings(); }
  refreshAppMenu();
  return ctx.settings;
});
handleInternal('lantern:theme-palette', (_ctx, _e, hex) => core.theme.palette(String(hex || '')));
handleInternal('lantern:mail-preview', (_ctx, _e, service, custom) => core.mail.url(String(service || ''), String(custom || '')));
handleInternal('lantern:reset-site-permissions', (ctx, _e, origin) => {
  if (origin) delete ctx.settings.sitePermissions[String(origin)];
  else ctx.settings.sitePermissions = {};
  ctx.saveSettings();
  return ctx.settings.sitePermissions;
});
handleInternal('lantern:clear-data', async (ctx, _e, what) => {
  await clearBrowsingData(ctx, { cookies: !!(what && what.cookies), cache: !!(what && what.cache), history: !!(what && what.history) });
  return true;
});
handleInternal('lantern:pick-downloads-dir', async (ctx, event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: ctx.settings.downloadsDir || app.getPath('downloads') });
  if (r.canceled || !r.filePaths[0]) return ctx.settings.downloadsDir;
  ctx.settings.downloadsDir = r.filePaths[0];
  ctx.saveSettings();
  return ctx.settings.downloadsDir;
});
handleInternal('lantern:pick-background', async (ctx, event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, { title: 'Choose a background image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
  if (r.canceled || !r.filePaths[0]) return ctx.settings;
  const src = r.filePaths[0];
  if (fs.statSync(src).size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB');
  let ext = path.extname(src).slice(1).toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (!['jpg', 'png', 'webp', 'gif'].includes(ext)) throw new Error('Unsupported image type');
  const old = ctx.backgroundFile();
  if (old) fs.rmSync(old, { force: true });
  fs.copyFileSync(src, path.join(profiles.dir(ctx.id), `background.${ext}`));
  ctx.settings.ntpBackground = 'image';
  ctx.settings.bgVersion = Date.now();
  ctx.saveSettings();
  return ctx.settings;
});
handleInternal('lantern:remove-background', (ctx) => {
  const old = ctx.backgroundFile();
  if (old) fs.rmSync(old, { force: true });
  ctx.settings.ntpBackground = 'glow';
  ctx.saveSettings();
  return ctx.settings;
});
handleInternal('lantern:profile-update', (ctx, _e, patch) => {
  const p = profiles.update(ctx.id, patch || {});
  for (const c of contexts.values()) c.broadcast();
  refreshAppMenu();
  return p;
});
handleInternal('lantern:profile-create', (_ctx, _e, data) => {
  const p = profiles.create(data || {});
  openProfile(p.id, { section: 'you' });
  refreshAppMenu();
  return profiles.list();
});
handleInternal('lantern:profile-open', (_ctx, _e, id) => {
  if (!profiles.get(id)) throw new Error('No such profile');
  openProfile(id);
  return true;
});
handleInternal('lantern:profile-delete', async (ctx, _e, id) => {
  if (id === ctx.id || !profiles.get(id)) throw new Error('Cannot delete this profile here');
  const other = contexts.get(id);
  if (other) {
    for (const w of other.windows()) w.win.destroy();
    try { await other.session.clearStorageData(); await other.session.clearCache(); } catch {}
    contexts.delete(id);
  }
  profiles.remove(id);
  refreshAppMenu();
  for (const c of contexts.values()) c.broadcast();
  return profiles.list();
});
handleInternal('lantern:extensions', (ctx) => ctx.extensionList());
handleInternal('lantern:extension-remove', async (ctx, _e, id) => {
  const ext = ctx.session.extensions.getExtension(String(id));
  if (!ext) return ctx.extensionList();
  if (String(ext.path).startsWith(profiles.extensionsDir(ctx.id))) {
    const { uninstallExtension } = require('electron-chrome-web-store');
    await uninstallExtension(ext.id, { session: ctx.session, extensionsPath: profiles.extensionsDir(ctx.id) });
  } else {
    ctx.session.extensions.removeExtension(ext.id);
    const list = readJson(path.join(profiles.dir(ctx.id), 'unpacked.json'), []).filter((p) => p !== ext.path);
    writeAtomic(path.join(profiles.dir(ctx.id), 'unpacked.json'), JSON.stringify(list));
  }
  return ctx.extensionList();
});
handleInternal('lantern:extension-load-unpacked', async (ctx, event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, { title: 'Choose an extension folder', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return ctx.extensionList();
  await ctx.session.extensions.loadExtension(r.filePaths[0], { allowFileAccess: false });
  const file = path.join(profiles.dir(ctx.id), 'unpacked.json');
  const list = readJson(file, []);
  if (!list.includes(r.filePaths[0])) list.push(r.filePaths[0]);
  writeAtomic(file, JSON.stringify(list));
  return ctx.extensionList();
});
handleInternal('lantern:open-tab', (ctx, event, url) => {
  const target = String(url || '');
  if (!/^https:\/\/chromewebstore\.google\.com\//.test(target) && !target.startsWith(INTERNAL) && !KEY_PAGES.has(target)) throw new Error('Not allowed');
  const w = windowOfSender(event.sender) || ctx.focusedWindow() || openWindow(ctx);
  w.createTab(target, { index: w.order.indexOf(w.activeId) + 1 });
  return true;
});

// ---------- history, bookmarks, downloads (the Library page) ----------
function broadcastAll() { for (const w of windows) w.broadcast(); scheduleMenuRefresh(); }
let menuTimer = null;
function scheduleMenuRefresh() { clearTimeout(menuTimer); menuTimer = setTimeout(refreshAppMenu, 400); }
handleInternal('lantern:history', (ctx, _e, opts) => {
  const o = opts && typeof opts === 'object' ? opts : {};
  return { items: ctx.library.queryHistory({ text: String(o.text || '').slice(0, 200), before: Number(o.before) || 0, limit: Number(o.limit) || 100 }), saving: ctx.settings.saveHistory !== false, private: ctx.isPrivate };
});
handleInternal('lantern:history-remove', (ctx, _e, urls) => { ctx.library.removeHistory((Array.isArray(urls) ? urls : [urls]).slice(0, 1000).map(String)); return true; });
handleInternal('lantern:history-clear', (ctx, _e, sinceMs) => { ctx.library.clearHistory(Math.max(0, Number(sinceMs) || 0)); return true; });
handleInternal('lantern:bookmarks', (ctx) => ctx.library.listBookmarks());
handleInternal('lantern:bookmark-add', (ctx, _e, b) => { const r = ctx.library.addBookmark({ url: String(b && b.url || '').trim(), title: String(b && b.title || '') }); broadcastAll(); return r; });
handleInternal('lantern:bookmark-update', (ctx, _e, id, patch) => { const r = ctx.library.updateBookmark(String(id), patch && typeof patch === 'object' ? { title: patch.title, url: patch.url } : {}); broadcastAll(); return r; });
handleInternal('lantern:bookmark-remove', (ctx, _e, id) => { ctx.library.removeBookmark(String(id)); broadcastAll(); return true; });
handleInternal('lantern:bookmark-move', (ctx, _e, id, to) => { ctx.library.moveBookmark(String(id), Number(to)); broadcastAll(); return true; });
handleInternal('lantern:downloads', (ctx) => ctx.downloads.map((d) => ({ ...d, exists: d.state === 'completed' && !!d.path && fs.existsSync(d.path) })));
handleInternal('lantern:download-action', (ctx, _e, id, action) => {
  const d = ctx.downloads.find((x) => x.id === Number(id));
  if (!d) return false;
  if (action === 'open' && d.path) shell.openPath(d.path);
  else if (action === 'show' && d.path) shell.showItemInFolder(d.path);
  else if (action === 'remove') { ctx.downloads = ctx.downloads.filter((x) => x !== d); ctx.broadcast(); }
  return true;
});
handleInternal('lantern:downloads-clear', (ctx) => { ctx.downloads = ctx.downloads.filter((d) => d.state === 'progressing'); ctx.broadcast(); return true; });

// ---------- side panel: AI assistant ----------
function windowOfSender(sender) {
  for (const w of windows) if (w.panel && !w.panel.webContents.isDestroyed() && w.panel.webContents === sender) return w;
  const found = findTabByWebContentsId(sender.id, true);
  return found ? found.win : null;
}
function aiFetch() {
  if (process.env.LANTERN_AI_MOCK && !app.isPackaged) { try { return require('../test/ai-mock').mockFetch; } catch {} }
  return (u, o) => fetchSession.fetch(u, o);
}
const aiRuns = new Map(); // request id -> AbortController

handleInternal('lantern:ai-state', (ctx) => ctx.ai.state());
handleInternal('lantern:ai-detect', (_ctx, _e, key) => core.ai.detect(String(key || '').slice(0, 500)));
handleInternal('lantern:ai-save-key', async (ctx, _e, provider, key) => {
  const v = core.ai.validateKey(String(provider || ''), String(key || '').slice(0, 1000));
  if (!v.ok) return { ok: false, message: v.message, suggest: v.suggest || null };
  const r = await listModels(aiFetch(), provider, v.key);
  if (r.error && !r.offline && [400, 401, 403].includes(r.status)) return { ok: false, message: r.error };
  ctx.ai.setKey(provider, v.key);
  if (r.models && r.models.length) ctx.ai.setModelList(provider, r.models);
  broadcastAll();
  const name = core.ai.providers().find((p) => p.id === provider).short;
  const message = r.offline ? `Saved. Lantern couldn't reach ${name} to check the key, so it will be checked the first time you use it.`
    : r.error ? `Saved. ${r.error}` : `Saved and checked. ${r.models.length} ${name} model${r.models.length === 1 ? '' : 's'} available.`;
  return { ok: true, message, state: ctx.ai.state() };
});
handleInternal('lantern:ai-remove-key', (ctx, _e, provider) => { ctx.ai.removeKey(String(provider)); broadcastAll(); return ctx.ai.state(); });
handleInternal('lantern:ai-set-active', (ctx, _e, provider) => { ctx.ai.setActive(String(provider)); broadcastAll(); return ctx.ai.state(); });
handleInternal('lantern:ai-set-model', (ctx, _e, provider, model) => { ctx.ai.setModel(String(provider), String(model)); return ctx.ai.state(); });
handleInternal('lantern:ai-refresh-models', async (ctx, _e, provider) => {
  provider = String(provider);
  const key = ctx.ai.key(provider);
  if (!key) throw new Error('Add a key first');
  const r = await listModels(aiFetch(), provider, key);
  if (r.error) throw new Error(r.error);
  ctx.ai.setModelList(provider, r.models);
  return ctx.ai.state();
});
handleInternal('lantern:ai-send', async (ctx, event, payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const id = String(p.id || crypto.randomUUID()).slice(0, 64);
  const messages = (Array.isArray(p.messages) ? p.messages : []).slice(-40)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '').slice(0, 40000) }));
  const st = ctx.ai.state();
  const provider = p.provider && ctx.ai.hasKey(String(p.provider)) ? String(p.provider) : st.active;
  if (!provider) throw new Error('Add an API key for Claude, ChatGPT, Gemini or Groq first.');
  const key = ctx.ai.key(provider);
  if (!key) throw new Error('Lantern couldn\'t read the saved key. Remove it and add it again.');
  const model = ctx.ai.model(provider);
  const w = windowOfSender(event.sender);
  let system = SYSTEM_PROMPT;
  let page = null;
  if (p.includePage && w) {
    page = await readActivePage(w).catch(() => null);
    if (page && page.text) system += '\n\n' + core.ai.pageContext(page.title, page.url, page.text, 16000);
  }
  if (p.selection) system += '\n\nThe user selected this text on the page:\n<selection>\n' + String(p.selection).slice(0, 4000) + '\n</selection>';
  const sender = event.sender;
  const emit = (m) => { if (!sender.isDestroyed()) sender.send('lantern:ai-event', { id, ...m }); };
  const ctrl = new AbortController();
  aiRuns.set(id, ctrl);
  const info = core.ai.providers().find((x) => x.id === provider);
  emit({ type: 'start', provider, name: info.short, model, page: page ? { title: page.title, url: page.url } : null });
  streamChat(aiFetch(), { provider, key, model, system, messages, signal: ctrl.signal, onDelta: (text) => emit({ type: 'delta', text }) })
    .then((r) => emit({ type: 'done', finish: r.finish }))
    .catch((err) => emit({ type: 'error', message: err.message }))
    .finally(() => aiRuns.delete(id));
  return { id, provider, model };
});
handleInternal('lantern:ai-stop', (_ctx, _e, id) => { const c = aiRuns.get(String(id)); if (c) c.abort(); return true; });

// ---------- side panel: reading mode and share ----------
// Reads the page in the active tab as clean text: headings, paragraphs and list items, nothing
// that could run. Used by reading mode and as context for the AI.
async function readActivePage(w) {
  const t = w.activeTab();
  const wc = w.activeWc();
  if (!t || !wc || !/^https?:/.test(t.url)) return null;
  const grab = async (code) => { try { return await wc.executeJavaScriptInIsolatedWorld(1999, [{ code }]); } catch (err) { if (TEST_SHOT_DIR) fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] grab failed ${err.message}\n`); return ''; } };
  const html = String(await grab('(() => { const h = document.documentElement ? document.documentElement.outerHTML : ""; return h.length > 3e6 ? h.slice(0, 3e6) : h; })()') || '');
  const url = wc.getURL();
  let title = wc.getTitle() || url;
  let byline = '';
  let site = hostOf(url);
  let blocks = [];
  try {
    const { parseHTML } = require('linkedom');
    const { Readability } = require('@mozilla/readability');
    const { document } = parseHTML(html);
    const article = new Readability(document, { charThreshold: 300 }).parse();
    if (article && article.content) {
      title = article.title || title;
      byline = article.byline || '';
      site = article.siteName || site;
      const { document: doc } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
      const BLOCK = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION']);
      const walk = (node) => {
        for (const el of node.children || []) {
          if (blocks.length >= 600) return;
          if (BLOCK.has(el.tagName)) {
            const text = String(el.textContent || '').replace(el.tagName === 'PRE' ? /[ \t]+$/gm : /\s+/g, el.tagName === 'PRE' ? '' : ' ').trim();
            if (text) blocks.push({ t: el.tagName.toLowerCase(), text: text.slice(0, 8000) });
          } else walk(el);
        }
      };
      walk(doc.body);
    }
  } catch {}
  if (TEST_SHOT_DIR) fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] readActivePage ${url} html=${html.length} blocks=${blocks.length}\n`);
  if (blocks.length < 3) {
    const text = String(await grab('document.body ? document.body.innerText.slice(0, 200000) : ""') || '');
    blocks = text.split(/\n\s*\n|\n/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, 600).map((x) => ({ t: 'p', text: x }));
  }
  const text = blocks.map((b) => (/^h\d$/.test(b.t) ? `## ${b.text}` : b.t === 'li' ? `- ${b.text}` : b.text)).join('\n\n');
  const words = text.split(/\s+/).filter(Boolean).length;
  return { title, byline, site, url, blocks, text, words, minutes: Math.max(1, Math.round(words / 230)) };
}
handleInternal('lantern:panel-read', async (_ctx, event) => {
  const w = windowOfSender(event.sender);
  if (!w) throw new Error('Not allowed');
  const page = await readActivePage(w);
  if (!page) return null;
  const { text, ...rest } = page;
  return rest;
});
handleInternal('lantern:panel-share', (_ctx, event) => {
  const w = windowOfSender(event.sender);
  const t = w && w.activeTab();
  if (!t || !/^https?:/.test(t.url)) return null;
  const dark = nativeTheme.shouldUseDarkColors;
  return { url: t.url, title: tabTitle(t), qr: core.qr(t.url, '#111318', '#ffffff').svg, dark };
});
handleInternal('lantern:panel-copy', (_ctx, event, text) => { if (!windowOfSender(event.sender)) throw new Error('Not allowed'); clipboard.writeText(String(text || '').slice(0, 200000)); return true; });
handleInternal('lantern:panel-save-qr', async (_ctx, event) => {
  const w = windowOfSender(event.sender);
  const t = w && w.activeTab();
  if (!t || !/^https?:/.test(t.url)) return false;
  const r = await dialog.showSaveDialog(w.win, { defaultPath: path.join(app.getPath('downloads'), `${hostOf(t.url) || 'page'}-qr.svg`), filters: [{ name: 'SVG image', extensions: ['svg'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, core.qr(t.url, '#000000', '#ffffff').svg);
  return true;
});
handleInternal('lantern:panel-close', (_ctx, event) => { const w = windowOfSender(event.sender); if (w) w.closePanel(); return true; });
handleInternal('lantern:panel-open', (_ctx, event, mode, extra) => {
  const w = windowOfSender(event.sender);
  if (!w) throw new Error('Not allowed');
  const m = ['ai', 'reader', 'share'].includes(mode) ? mode : 'ai';
  w.openPanel(m, extra && typeof extra === 'object' ? { view: extra.view === 'keys' ? 'keys' : undefined } : {});
  return true;
});
handleInternal('lantern:restore-session', (ctx, event) => {
  const s = ctx.lastSession();
  if (!s) return false;
  const found = findTabByWebContentsId(event.sender.id, true);
  s.windows.forEach((sw, i) => {
    const urls = sw.tabs.map((t) => t.url);
    if (i === 0 && found) sw.tabs.forEach((t) => found.win.createTab(t.url, { activate: false, pinned: !!t.pinned }));
    else openWindow(ctx, { urls, pinned: sw.tabs.map((t) => !!t.pinned) });
  });
  ctx.crashed = false;
  return true;
});
handleInternal('lantern:safety-proceed', (ctx, event, url, type) => {
  const target = String(url || '');
  if (!/^https?:\/\//.test(target)) throw new Error('Not allowed');
  if (type === 'cert') ctx.certBypass.add(hostOf(target));
  else ctx.bypass.add(hostOf(target));
  event.sender.loadURL(target);
  return true;
});
handleInternal('lantern:safety-status', async (ctx, _e, refresh) => {
  if (refresh && threats && !USE_FIXTURES) await threats.refresh(true).catch(() => {});
  return {
    lists: threats ? threats.status() : null,
    extensions: ctx.extensionList().length,
    remembered: Object.keys(ctx.settings.sitePermissions || {}).length,
    blockedTotal: ctx.blockedTotal,
    settings: ctx.settings,
  };
});
handleInternal('lantern:dismiss-restore', (ctx) => { ctx.crashed = false; return true; });

// ---------- browser frame (tab strip + toolbar) IPC ----------
ipcMain.handle('ui-suggest', (event, text, remote) => {
  const w = windowForUiSender(event.sender);
  if (!w) throw new Error('Not allowed');
  return suggestionsFor(w.ctx, w, text, { remote: !!remote });
});
// Clicks inside the suggestion popup.
ipcMain.on('suggest-popup', (event, msg) => {
  const w = [...windows].find((x) => x.suggestView && !x.suggestView.webContents.isDestroyed() && x.suggestView.webContents === event.sender);
  if (!w || !msg) return;
  if (msg.type === 'pick') w.pickSuggestion(Number(msg.index), { summary: !!msg.summary });
  if (msg.type === 'remove') {
    const item = (w.suggestItems || [])[Number(msg.index)];
    if (item && item.type === 'recent') { w.ctx.forgetSearch(item.text); w.send('suggest-refresh'); }
  }
});
ipcMain.on('ui', (event, msg) => {
  const w = windowForUiSender(event.sender);
  if (!w || !msg || typeof msg.type !== 'string') return;
  const wc = w.activeWc();
  switch (msg.type) {
    case 'new-tab': w.createTab(); break;
    case 'close-tab': w.closeTab(msg.id); scheduleMenuRefresh(); break;
    case 'activate': w.activateTab(msg.id); break;
    case 'move': {
      const from = w.order.indexOf(msg.id);
      if (from >= 0) { w.order.splice(from, 1); w.order.splice(Math.max(0, Math.min(w.order.length, Number(msg.to) || 0)), 0, msg.id); w.settleOrder(); w.broadcast(); }
      break;
    }
    case 'tab-menu': w.showTabMenu(Number(msg.id), msg.x, msg.y); break;
    case 'mute': w.toggleMute(Number(msg.id)); break;
    case 'bookmark': w.toggleBookmark(); scheduleMenuRefresh(); break;
    case 'zoom-reset': w.zoom(0); break;
    case 'panel': w.togglePanel(['ai', 'reader', 'share'].includes(msg.mode) ? msg.mode : 'ai'); break;
    case 'ai-menu': showAiMenu(w, msg.x, msg.y); break;
    case 'bookmark-open': {
      const b = w.ctx.library.listBookmarks().find((x) => x.id === msg.id);
      if (!b) break;
      if (msg.newTab) w.createTab(b.url, { activate: !!msg.foreground, index: w.order.indexOf(w.activeId) + 1 });
      else if (wc) { wc.loadURL(b.url); wc.focus(); } else w.createTab(b.url);
      break;
    }
    case 'bookmark-menu': w.showBookmarkMenu(String(msg.id), msg.x, msg.y); break;
    case 'bookmarks-more': openLibrary(w, 'bookmarks'); break;
    case 'private-window': openPrivateWindow(w.ctx); break;
    case 'navigate': if (wc) { wc.loadURL(toUrl(w.ctx, msg.text, msg.summary)); wc.focus(); } break;
    case 'back': wc && wc.navigationHistory.goBack(); break;
    case 'forward': wc && wc.navigationHistory.goForward(); break;
    case 'reload': wc && wc.reload(); break;
    case 'stop': wc && wc.stop(); break;
    case 'home': wc && wc.loadURL(NEWTAB_URL); break;
    case 'summary-mode': w.ctx.settings.summaryMode = !!msg.on; w.ctx.saveSettings(); break;
    case 'menu': showMainMenu(w, msg.x, msg.y); break;
    case 'profile-menu': showProfileMenu(w, msg.x, msg.y); break;
    case 'downloads-menu': showDownloadsMenu(w, msg.x, msg.y); break;
    case 'find': if (wc && typeof msg.text === 'string') { if (msg.text) wc.findInPage(msg.text, { forward: msg.forward !== false, findNext: !!msg.next }); else wc.stopFindInPage('clearSelection'); } break;
    case 'find-close': wc && wc.stopFindInPage('clearSelection'); break;
    case 'win': if (msg.action === 'min') w.win.minimize(); else if (msg.action === 'max') (w.win.isMaximized() ? w.win.unmaximize() : w.win.maximize()); else if (msg.action === 'close') w.win.close(); break;
    case 'suggest-show': w.showSuggestions(msg.items, Number(msg.selected), msg.rect, msg.query); break;
    case 'suggest-hide': w.hideSuggestions(); break;
    case 'suggest-pick': w.pickSuggestion(Number(msg.index), { summary: !!msg.summary }); break;
    case 'suggest-remove': {
      const item = (w.suggestItems || [])[Number(msg.index)];
      if (item && item.type === 'recent') w.ctx.forgetSearch(item.text);
      break;
    }
    case 'ready': w.broadcast(); break;
  }
});

// ---------- startup ----------
async function loadBlocker() {
  if (USE_FIXTURES) return;
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const cache = path.join(app.getPath('userData'), 'blocklist.bin');
    try { if (Date.now() - fs.statSync(cache).mtimeMs > 7 * 864e5) fs.unlinkSync(cache); } catch {}
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking((u, o) => net.fetch(u, o), {
      path: cache, read: fs.promises.readFile, write: fs.promises.writeFile,
    });
  } catch (err) {
    console.error('Tracker blocklist could not be loaded:', err.message);
  }
}

async function loadUnpacked(ctx) {
  for (const dir of readJson(path.join(profiles.dir(ctx.id), 'unpacked.json'), [])) {
    try { await ctx.session.extensions.loadExtension(dir); } catch {}
  }
}

function startupWindows(ctx) {
  const s = ctx.settings;
  if (s.startup === 'continue') {
    const last = ctx.lastSession();
    if (last && last.windows.length) {
      ctx.crashed = false;
      for (const w of last.windows) openWindow(ctx, { urls: w.tabs.map((t) => t.url), pinned: w.tabs.map((t) => !!t.pinned) });
      return;
    }
  }
  if (s.startup === 'url' && s.startupUrl) return openWindow(ctx, { urls: [s.startupUrl] });
  const startUrl = process.argv.find((a) => /^https?:\/\//.test(a));
  openWindow(ctx, { urls: startUrl ? [startUrl] : [] });
}

async function runScreenshotTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(TEST_SHOT_DIR, { recursive: true });
  const w = [...windows][0];
  const shots = (process.env.LANTERN_SHOTS || 'newtab').split(',');
  if (process.env.LANTERN_TEST_EXT) {
    const ext = await w.ctx.session.extensions.loadExtension(process.env.LANTERN_TEST_EXT);
    fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] loaded extension ${ext.name}; list=${JSON.stringify(w.ctx.extensionList().map((e) => e.name))}\n`);
  }
  w.win.setContentSize(Number(process.env.LANTERN_W || 1280), Number(process.env.LANTERN_H || 820));
  w.win.showInactive();
  await wait(2500);
  for (const t of w.tabs.values()) t.view.webContents.on('console-message', (e) => fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[${e.level}] ${e.message}\n`));
  const shoot = async (name) => {
    const [cw] = w.win.getContentSize();
    const ui = await w.win.webContents.capturePage({ x: 0, y: 0, width: cw, height: w.uiHeight() });
    const page = await w.activeWc().capturePage();
    if (w.panelOpen && w.panel) {
      await new Promise((r) => setTimeout(r, 300));
      fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-panel.png`), (await w.panel.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-ui.png`), ui.toPNG());
    fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-page.png`), page.toPNG());
    const sv = w.suggestView;
    if (sv && w.win.contentView.children.includes(sv)) {
      const pop = await sv.webContents.capturePage();
      fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-popup.png`), pop.toPNG());
      fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] popup ${name} ${JSON.stringify(sv.getBounds())} items=${JSON.stringify(w.suggestItems.map((x) => x.type + ':' + x.text))}\n`);
    }
  };
  for (const q of (process.env.LANTERN_TEST_RECENT || '').split(';').filter(Boolean).reverse()) w.ctx.rememberSearch(q);
  for (const shot of shots) {
    const [name, url, delay, tall, scroll, action] = shot.split('|');
    if (url) {
      const t = w.createTab(/^(https?|data|about):/.test(url) ? url : INTERNAL + url);
      t.view.webContents.on('console-message', (e) => fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[${e.level}] ${e.message}\n`));
      await wait(Number(delay || 3500));
    }
    if (tall) { w.win.setContentSize(Number(process.env.LANTERN_W || 1280), Number(tall)); w.layout(); await wait(1200); }
    if (action === 'crash') { w.activeWc().forcefullyCrashRenderer(); await wait(2500); }
    if (action && action.startsWith('omni:')) {
      // Type into the address bar like a person would, then optionally press the down arrow.
      const [text, downs] = action.slice(5).split('~');
      w.win.webContents.focus();
      await w.win.webContents.executeJavaScript(`(() => { const a = document.getElementById('address'); a.focus(); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); })()`);
      await wait(1200);
      for (let i = 0; i < Number(downs || 0); i++) { w.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); w.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(250); }
      await wait(400);
    }
    if (action && action.startsWith('page:')) {
      const [text, downs] = action.slice(5).split('~');
      const wc = w.activeWc();
      wc.focus();
      await wc.executeJavaScript(`(() => { const q = document.getElementById('q'); q.focus(); q.value = ${JSON.stringify(text)}; q.dispatchEvent(new Event(${JSON.stringify(text ? 'input' : 'focus')})); })()`);
      await wait(1200);
      for (let i = 0; i < Number(downs || 0); i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(250); }
      await wait(400);
    }
    if (action === 'proceed') {
      await shoot(name + '-before');
      await w.activeWc().executeJavaScript(`document.getElementById('details-toggle').click(); document.getElementById('proceed').click();`);
      await wait(3000);
    }
    if (scroll) { await w.activeWc().executeJavaScript(`window.scrollTo({ top: ${Number(scroll)}, behavior: 'instant' })`); await wait(1200); }
    await shoot(name);
    if (tall) { w.win.setContentSize(Number(process.env.LANTERN_W || 1280), Number(process.env.LANTERN_H || 820)); w.layout(); }
  }
  await wait(800);
  if (process.env.LANTERN_EVAL) {
    const r = await w.activeWc().executeJavaScript(process.env.LANTERN_EVAL).catch((e) => 'ERR ' + e.message);
    fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] eval ${typeof r === 'string' ? r : JSON.stringify(r)}\n`);
  }
  const diag = await w.win.webContents.executeJavaScript(`JSON.stringify({ defined: !!customElements.get('browser-action-list'), api: typeof browserAction, hidden: document.getElementById('actions').hidden, partition: document.getElementById('actions').getAttribute('partition'), actions: document.getElementById('actions').shadowRoot ? document.getElementById('actions').shadowRoot.querySelectorAll('.action').length : -1 })`);
  fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] ui ${diag}\n`);
  if (process.env.LANTERN_TEST_PROFILE) {
    const p = profiles.create({ name: 'Work', color: '#2f6fdf' });
    const w2 = openProfile(p.id);
    w2.win.setContentSize(1280, 820);
    w2.win.showInactive();
    await wait(4000);
    const ui = await w2.win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: UI_HEIGHT });
    fs.writeFileSync(path.join(TEST_SHOT_DIR, 'profile2-ui.png'), ui.toPNG());
    fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] profiles=${JSON.stringify(profiles.list().map((x) => x.name))} partitions=${[...contexts.values()].map((c) => c.partition).join(',')}\n`);
  }
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  const w = focusedController();
  if (!w) return;
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  const url = argv.find((a) => /^https?:\/\//.test(a));
  if (url) w.createTab(url);
});

app.whenReady().then(async () => {
  profiles = new Profiles(app.getPath('userData'));
  if (TEST_SHOT_DIR) nativeTheme.themeSource = process.env.LANTERN_THEME || 'light';
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  fetchSession = session.fromPartition('lantern-fetch'); // in-memory: search requests leave nothing on disk
  fetchSession.setUserAgent(cleanUserAgent(fetchSession.getUserAgent()));
  const uiSession = session.fromPartition(UI_PARTITION);
  try { require('electron-chrome-extensions').ElectronChromeExtensions.handleCRXProtocol(uiSession); } catch {}

  const ctx = getContext(profiles.lastUsed().id);
  await ctx.ready;
  if (TEST_SHOT_DIR && process.env.LANTERN_THEME) nativeTheme.themeSource = process.env.LANTERN_THEME;
  await loadUnpacked(ctx).catch(() => {});
  refreshAppMenu();
  startupWindows(ctx);
  if (TEST_SHOT_DIR && process.env.LANTERN_TEST_SCRIPT && !app.isPackaged) {
    // Development-only scripted tests (never in a packaged build).
    [...windows][0].win.webContents.once('did-finish-load', () => setTimeout(() => {
      require(path.resolve(process.env.LANTERN_TEST_SCRIPT))({ app, windows, contexts, core, profiles, openPrivateWindow, openLibrary, setBookmarksBar, showAiMenu, showMainMenu, refreshAppMenu, TEST_SHOT_DIR, INTERNAL })
        .catch((err) => fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[test] FAILED ${err.stack}\n`))
        .finally(() => app.quit());
    }, 300));
  } else if (TEST_SHOT_DIR) [...windows][0].win.webContents.once('did-finish-load', () => setTimeout(runScreenshotTest, 300));
  loadBlocker();
  threats = new ThreatLists(path.join(app.getPath('userData'), 'Safety'), (u) => fetchSession.fetch(u));
  if (USE_FIXTURES && process.env.LANTERN_TEST_THREATS) {
    threats.sets.phishing = parseList(fs.readFileSync(process.env.LANTERN_TEST_THREATS, 'utf8'));
    threats.updatedAt = Date.now();
  } else {
    threats.loadCached();
    threats.refresh().catch(() => {});
    setInterval(() => threats.refresh().catch(() => {}), 60 * 60_000);
  }

  setInterval(() => { for (const c of contexts.values()) c.saveSession(); }, SAVE_EVERY_MS);
  setInterval(() => { for (const w of windows) w.sleepIdleTabs(); }, 5 * 60_000);
  nativeTheme.on('updated', () => {
    if (IS_MAC) return;
    for (const w of windows) if (!w.win.isDestroyed()) w.win.setTitleBarOverlay(overlayColors());
  });
});

// Certificate errors are refused unless the user explicitly accepted that host on the warning page.
app.on('certificate-error', (event, wc, url, _error, _cert, callback) => {
  for (const ctx of contexts.values()) {
    if (wc.session === ctx.session && ctx.certBypass.has(hostOf(url))) { event.preventDefault(); return callback(true); }
  }
  callback(false);
});
// No page may embed <webview>, which would bypass the sandbox settings above.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.on('activate', () => {
  if (!windows.size && profiles) openWindow(getContext(profiles.lastUsed().id));
});

app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  for (const c of contexts.values()) c.saveSession();
  const toClear = [...contexts.values()].filter((c) => c.settings.clearOnExit);
  if (toClear.length) {
    e.preventDefault();
    for (const c of toClear) { try { await clearBrowsingData(c); } catch {} }
    for (const c of contexts.values()) c.markCleanExit();
    app.exit(0);
    return;
  }
  for (const c of contexts.values()) c.markCleanExit();
});
app.on('window-all-closed', () => { if (!IS_MAC || TEST_SHOT_DIR) app.quit(); });

module.exports = { toUrl };
