'use strict';
// Dangerous-site protection. Lantern keeps two open threat lists on the device and checks
// every page load against them locally, so the sites you visit are never sent anywhere.
//   Phishing: malware-filter/phishing-filter (OpenPhish, IPThreat, PhishTank) · MIT
//   Malware:  malware-filter/urlhaus-filter (abuse.ch URLhaus, CC0) · CC0/MIT
const fs = require('fs');
const path = require('path');

const LISTS = {
  phishing: [
    'https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt',
    'https://malware-filter.pages.dev/phishing-filter-domains.txt',
    'https://curbengh.github.io/malware-filter/phishing-filter-domains.txt',
  ],
  malware: [
    'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt',
    'https://malware-filter.pages.dev/urlhaus-filter-domains.txt',
    'https://curbengh.github.io/malware-filter/urlhaus-filter-domains.txt',
  ],
};
const REFRESH_MS = 12 * 60 * 60 * 1000; // the lists are rebuilt twice a day

// File types that can run code when opened.
const RISKY_EXT = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'hta', 'jar', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'ps1', 'psm1', 'reg', 'lnk', 'inf',
  'dmg', 'pkg', 'mpkg', 'app', 'command', 'tool', 'workflow', 'terminal',
  'sh', 'bash', 'run', 'bin', 'deb', 'rpm', 'appimage', 'apk', 'xapk',
]);

function parseList(text) {
  const set = new Set();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith('#') || line.startsWith('!') || line === '---') continue;
    const host = line.replace(/^0\.0\.0\.0\s+|^127\.0\.0\.1\s+/, '').split(/\s+/)[0];
    if (/^[a-z0-9.-]+$/.test(host) && host.includes('.')) set.add(host);
  }
  return set;
}

class ThreatLists {
  constructor(dir, fetchImpl) {
    this.dir = dir;
    this.fetch = fetchImpl;
    this.sets = { phishing: new Set(), malware: new Set() };
    this.updatedAt = 0;
    this.error = '';
    fs.mkdirSync(dir, { recursive: true });
  }

  file(kind) { return path.join(this.dir, `${kind}.txt`); }

  loadCached() {
    let newest = 0;
    for (const kind of Object.keys(LISTS)) {
      try {
        this.sets[kind] = parseList(fs.readFileSync(this.file(kind), 'utf8'));
        newest = Math.max(newest, fs.statSync(this.file(kind)).mtimeMs);
      } catch {}
    }
    this.updatedAt = newest;
  }

  async refresh(force = false) {
    if (!force && Date.now() - this.updatedAt < REFRESH_MS && this.count() > 0) return;
    let ok = 0;
    for (const [kind, urls] of Object.entries(LISTS)) {
      for (const url of urls) {
        try {
          const res = await this.fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const set = parseList(text);
          if (set.size < 100) throw new Error('list too small');
          this.sets[kind] = set;
          const tmp = this.file(kind) + '.tmp';
          fs.writeFileSync(tmp, text);
          fs.renameSync(tmp, this.file(kind));
          ok++;
          break;
        } catch (e) {
          this.error = `${kind}: ${e.message}`;
        }
      }
    }
    if (ok) { this.updatedAt = Date.now(); if (ok === 2) this.error = ''; }
  }

  count() { return this.sets.phishing.size + this.sets.malware.size; }

  /** Returns 'phishing', 'malware' or null for a URL. Checks the host and its parent domains. */
  check(url) {
    let host;
    try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
    if (!host) return null;
    const parts = host.split('.');
    for (let i = 0; i <= parts.length - 2 && i < 8; i++) {
      const candidate = parts.slice(i).join('.');
      if (this.sets.phishing.has(candidate)) return 'phishing';
      if (this.sets.malware.has(candidate)) return 'malware';
    }
    return null;
  }

  status() {
    return { phishing: this.sets.phishing.size, malware: this.sets.malware.size, updatedAt: this.updatedAt, error: this.error };
  }
}

function isRiskyFile(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return RISKY_EXT.has(ext);
}

module.exports = { ThreatLists, parseList, isRiskyFile, LISTS };
