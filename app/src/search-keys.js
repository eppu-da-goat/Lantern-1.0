'use strict';
// Optional keys for Lantern Search's full-web sources (Brave Search API, Mojeek API), encrypted
// with the system keychain like AI keys. The window only ever sees a masked version.
const fs = require('fs');
const path = require('path');

const PROVIDERS = {
  brave: { name: 'Brave Search API', url: 'https://api-dashboard.search.brave.com/', hint: 'Free plan available. Starts with BSA' },
  mojeek: { name: 'Mojeek API', url: 'https://www.mojeek.com/services/search/web-search-api/', hint: 'Paid, from Mojeek' },
};
const mask = (k) => (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`);

class SearchKeys {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'search-keys.json');
    this.safe = safeStorage;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch {}
  }
  save() {
    try {
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {}
  }
  set(id, key) {
    if (!PROVIDERS[id]) throw new Error('Unknown search source');
    const enc = this.safe && this.safe.isEncryptionAvailable() ? { enc: this.safe.encryptString(key).toString('base64') } : { plain: Buffer.from(key).toString('base64') };
    this.data[id] = { ...enc, mask: mask(key), added: Date.now() };
    this.save();
  }
  remove(id) { delete this.data[id]; this.save(); }
  get(id) {
    const k = this.data[id];
    if (!k) return '';
    try { return k.enc ? this.safe.decryptString(Buffer.from(k.enc, 'base64')) : Buffer.from(k.plain || '', 'base64').toString('utf8'); } catch { return ''; }
  }
  all() { return Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, this.get(id)]).filter(([, v]) => v)); }
  state() { return Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p, mask: this.data[id] ? this.data[id].mask : '' })); }
}

module.exports = { SearchKeys, SEARCH_KEY_PROVIDERS: PROVIDERS };
