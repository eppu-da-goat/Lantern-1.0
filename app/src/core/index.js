'use strict';
// Loads Lantern's Rust core (lantern_core.wasm, built from rust/lantern-core) and calls into it.
// Every call is synchronous and pure: JSON in, JSON out. If a call ever traps, the module is
// reloaded so one bad input can't leave the core in a broken state.
const fs = require('fs');
const path = require('path');

const WASM_PATH = path.join(__dirname, 'lantern_core.wasm');
let wasmModule = null;
let instance = null;
const enc = new TextEncoder();
const dec = new TextDecoder();

function load() {
  if (!wasmModule) wasmModule = new WebAssembly.Module(fs.readFileSync(WASM_PATH));
  instance = new WebAssembly.Instance(wasmModule, {});
  return instance;
}

function call(fn, args = {}) {
  const inst = instance || load();
  const { memory, lc_alloc, lc_free, lc_call } = inst.exports;
  const input = enc.encode(JSON.stringify({ fn, args }));
  let ptr = 0;
  let out;
  try {
    ptr = lc_alloc(input.length);
    new Uint8Array(memory.buffer, ptr, input.length).set(input);
    const packed = lc_call(ptr, input.length);
    lc_free(ptr, input.length);
    ptr = 0;
    const outPtr = Number(BigInt.asUintN(64, packed) >> 32n);
    const outLen = Number(BigInt.asUintN(64, packed) & 0xffffffffn);
    out = dec.decode(new Uint8Array(memory.buffer, outPtr, outLen).slice());
    lc_free(outPtr, outLen);
  } catch (err) {
    instance = null; // trapped: start fresh next time
    throw new Error(`Lantern core failed in ${fn}: ${err.message}`);
  }
  const res = JSON.parse(out);
  if (res.error) throw new Error(res.error);
  return res.ok;
}

module.exports = {
  call,
  version: () => call('version'),
  ai: {
    providers: () => call('ai.providers'),
    detect: (key) => call('ai.detect', { key }),
    validateKey: (provider, key) => call('ai.validateKey', { provider, key }),
    maskKey: (key) => call('ai.maskKey', { key }),
    buildChat: (args) => call('ai.buildChat', args),
    parseChat: (provider, status, body) => call('ai.parseChat', { provider, status, body }),
    sseFeed: (provider, buffer) => call('ai.sseFeed', { provider, buffer }),
    explainError: (provider, status, body) => call('ai.explainError', { provider, status, body }),
    buildModels: (provider, key) => call('ai.buildModels', { provider, key }),
    parseModels: (provider, body) => call('ai.parseModels', { provider, body }),
    pageContext: (title, url, text, limit) => call('ai.pageContext', { title, url, text, limit }),
  },
  theme: {
    palette: (hex) => call('theme.palette', { hex }),
    contrast: (a, b) => call('theme.contrast', { a, b }),
  },
  settings: {
    validate: (key, value) => call('settings.validate', { key, value }),
    keys: () => call('settings.keys'),
  },
  mail: {
    services: () => call('mail.services'),
    url: (service, custom) => call('mail.url', { service, custom }),
  },
  rank: (query, items, { now = Date.now(), limit = 8 } = {}) => call('rank.entries', { query, items, now, limit }),
  qr: (text, dark, light) => call('qr.svg', { text, dark, light }),
};
