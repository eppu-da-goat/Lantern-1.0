'use strict';
// Profiles: each one has its own cookies, history, extensions and settings.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COLORS = ['#e2700c', '#2f6fdf', '#1f9d6b', '#c2410c', '#8b5cf6', '#db2777', '#0e7490', '#6b7280'];

const DEFAULT_SETTINGS = {
  searchEngine: 'lantern',
  indexPages: true,
  searchSources: {},
  summaryMode: true,
  searchSuggestions: true,
  rememberSearches: true,
  blockTrackers: true,
  httpsOnly: true,
  blockThirdPartyCookies: true,
  sendGpc: true,
  clearOnExit: false,
  memorySaver: true,
  safeBrowsing: true,
  downloadWarnings: true,
  camera: 'ask',
  microphone: 'ask',
  notifications: 'block',
  location: 'block',
  sitePermissions: {},
  theme: 'system',
  themeColor: 'ember',
  ntpBackground: 'glow',
  bgVersion: 0,
  shortcuts: [],
  showShortcuts: true,
  toolbarSummary: true,
  toolbarShield: true,
  showHomeButton: true,
  defaultZoom: 1,
  startup: 'newtab',
  startupUrl: '',
  lastSession: [],
  downloadsAsk: false,
  downloadsDir: '',
  // 1.5
  saveHistory: true,
  bookmarksBar: false,
  inlineAutocomplete: true,
  showAiButton: true,
  aiIncludePage: true,
  mailService: 'gmail',
  mailUrl: '',
  customAccent: '',
  // 1.6
  bangs: true,
  customBangs: [],
  tabLayout: 'horizontal',
  tabSide: 'left',
  tabsCollapsed: false,
  tabsWidth: 220,
  compactMode: false,
  mruTabSwitching: false,
  showSplitButton: true,
  fingerprinting: 'standard',
  siteShields: {},
  apps: [],
  stripTracking: true,
  hideAdElements: true,
};

const ENGINES = {
  lantern: { name: 'Lantern Search', url: 'lantern://app/search.html?q=%s' },
  mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
};

class Profiles {
  constructor(userData) {
    this.userData = userData;
    this.root = path.join(userData, 'Profiles');
    this.indexPath = path.join(this.root, 'profiles.json');
    fs.mkdirSync(this.root, { recursive: true });
    this.index = this._readIndex();
  }

  _readIndex() {
    let idx = null;
    try { idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch {}
    if (!idx || !Array.isArray(idx.profiles) || !idx.profiles.length) {
      idx = { profiles: [{ id: 'default', name: 'Personal', color: COLORS[0], createdAt: Date.now() }], lastUsed: 'default' };
      // Carry over settings from Lantern 1.0, which kept one settings.json at the top level.
      const legacy = path.join(this.userData, 'settings.json');
      const dir = path.join(this.root, 'default');
      fs.mkdirSync(dir, { recursive: true });
      try { if (fs.existsSync(legacy)) fs.copyFileSync(legacy, path.join(dir, 'settings.json')); } catch {}
      this._writeIndex(idx);
    }
    return idx;
  }
  _writeIndex(idx = this.index) {
    try { fs.writeFileSync(this.indexPath, JSON.stringify(idx, null, 2)); } catch {}
  }

  list() { return this.index.profiles.map((p) => ({ ...p })); }
  get(id) { return this.index.profiles.find((p) => p.id === id) || null; }
  lastUsed() { return this.get(this.index.lastUsed) || this.index.profiles[0]; }
  setLastUsed(id) { if (this.get(id)) { this.index.lastUsed = id; this._writeIndex(); } }

  dir(id) { return path.join(this.root, id); }
  partition(id) { return id === 'default' ? 'persist:lantern' : `persist:lantern-${id}`; }
  extensionsDir(id) { return path.join(this.dir(id), 'Extensions'); }

  create({ name, color } = {}) {
    const id = crypto.randomBytes(5).toString('hex');
    const used = new Set(this.index.profiles.map((p) => p.color));
    const profile = {
      id,
      name: String(name || '').trim().slice(0, 40) || `Profile ${this.index.profiles.length + 1}`,
      color: COLORS.includes(color) ? color : (COLORS.find((c) => !used.has(c)) || COLORS[this.index.profiles.length % COLORS.length]),
      createdAt: Date.now(),
    };
    fs.mkdirSync(this.dir(id), { recursive: true });
    this.index.profiles.push(profile);
    this._writeIndex();
    return { ...profile };
  }

  update(id, patch) {
    const p = this.get(id);
    if (!p) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 40);
    if (COLORS.includes(patch.color)) p.color = patch.color;
    this._writeIndex();
    return { ...p };
  }

  remove(id) {
    if (this.index.profiles.length <= 1) return false;
    this.index.profiles = this.index.profiles.filter((p) => p.id !== id);
    if (this.index.lastUsed === id) this.index.lastUsed = this.index.profiles[0].id;
    this._writeIndex();
    try { fs.rmSync(this.dir(id), { recursive: true, force: true }); } catch {}
    return true;
  }

  loadSettings(id) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(path.join(this.dir(id), 'settings.json'), 'utf8')); } catch {}
    const s = { ...DEFAULT_SETTINGS, ...saved };
    if (!ENGINES[s.searchEngine]) s.searchEngine = 'lantern';
    return s;
  }
  saveSettings(id, settings) {
    try {
      fs.mkdirSync(this.dir(id), { recursive: true });
      fs.writeFileSync(path.join(this.dir(id), 'settings.json'), JSON.stringify(settings, null, 2));
    } catch {}
  }
}

module.exports = { Profiles, COLORS, DEFAULT_SETTINGS, ENGINES };
