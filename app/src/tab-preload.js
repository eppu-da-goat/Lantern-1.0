'use strict';
// Runs in every tab, but only Lantern's own pages (lantern://app) get the bridge.
// Websites never see window.lantern.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'lantern:' && location.host === 'app') {
  const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
  contextBridge.exposeInMainWorld('lantern', {
    search: call('lantern:search'),
    suggest: call('lantern:suggest'),
    forgetSearch: call('lantern:forget-search'),
    summarize: call('lantern:summary'),
    info: call('lantern:info'),
    setSetting: call('lantern:set-setting'),
    resetSitePermissions: call('lantern:reset-site-permissions'),
    clearData: call('lantern:clear-data'),
    pickDownloadsDir: call('lantern:pick-downloads-dir'),
    updateProfile: call('lantern:profile-update'),
    createProfile: call('lantern:profile-create'),
    openProfile: call('lantern:profile-open'),
    deleteProfile: call('lantern:profile-delete'),
    extensions: call('lantern:extensions'),
    removeExtension: call('lantern:extension-remove'),
    loadUnpacked: call('lantern:extension-load-unpacked'),
    openTab: call('lantern:open-tab'),
    restoreSession: call('lantern:restore-session'),
    dismissRestore: call('lantern:dismiss-restore'),
    safetyProceed: call('lantern:safety-proceed'),
    safetyStatus: call('lantern:safety-status'),
    pickBackground: call('lantern:pick-background'),
    removeBackground: call('lantern:remove-background'),
    themePalette: call('lantern:theme-palette'),
    mailPreview: call('lantern:mail-preview'),
    // History, bookmarks and downloads
    history: call('lantern:history'),
    removeHistory: call('lantern:history-remove'),
    clearHistory: call('lantern:history-clear'),
    bookmarks: call('lantern:bookmarks'),
    addBookmark: call('lantern:bookmark-add'),
    updateBookmark: call('lantern:bookmark-update'),
    removeBookmark: call('lantern:bookmark-remove'),
    moveBookmark: call('lantern:bookmark-move'),
    downloads: call('lantern:downloads'),
    downloadAction: call('lantern:download-action'),
    clearDownloads: call('lantern:downloads-clear'),
    // AI assistant (keys never come back here, only masked)
    aiState: call('lantern:ai-state'),
    aiDetect: call('lantern:ai-detect'),
    aiSaveKey: call('lantern:ai-save-key'),
    aiRemoveKey: call('lantern:ai-remove-key'),
    aiSetActive: call('lantern:ai-set-active'),
    aiSetModel: call('lantern:ai-set-model'),
    aiRefreshModels: call('lantern:ai-refresh-models'),
    aiSend: call('lantern:ai-send'),
    aiStop: call('lantern:ai-stop'),
    onAiEvent: (fn) => ipcRenderer.on('lantern:ai-event', (_e, m) => fn(m)),
    // Side panel
    panelRead: call('lantern:panel-read'),
    panelShare: call('lantern:panel-share'),
    panelCopy: call('lantern:panel-copy'),
    panelSaveQr: call('lantern:panel-save-qr'),
    panelClose: call('lantern:panel-close'),
    panelOpen: call('lantern:panel-open'),
    onPanel: (fn) => ipcRenderer.on('lantern:panel', (_e, m) => fn(m)),
    onProgress: (fn) => ipcRenderer.on('lantern:progress', (_e, step) => fn(step)),
    // 1.6
    bangsList: call('lantern:bangs-list'),
    services: call('lantern:services'),
    setService: call('lantern:services-set'),
    importSources: call('lantern:import-sources'),
    importBrowser: call('lantern:import'),
    importHtml: call('lantern:import-html'),
    exportHtml: call('lantern:export-html'),
    apps: call('lantern:apps'),
    openApp: call('lantern:app-open'),
    removeApp: call('lantern:app-remove'),
    resetShields: call('lantern:shields-reset'),
    // 1.7: Lantern Search
    searchState: call('lantern:search-state'),
    searchKey: call('lantern:search-key'),
    searchKeyRemove: call('lantern:search-key-remove'),
    searchIndexClear: call('lantern:search-index-clear'),
    qr: call('lantern:qr'),
    cleanUrl: call('lantern:clean-url'),
  });
}

// Websites see the same window.chrome members every Chromium browser has (Electron leaves it empty,
// which sign-in pages read as "an app with a browser built in"). Runs before any page script.
if ((location.protocol === 'https:' || location.protocol === 'http:') && contextBridge.executeInMainWorld) {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const c = window.chrome && typeof window.chrome === 'object' ? window.chrome : {};
        const nav = () => (performance.getEntriesByType('navigation')[0] || {});
        const define = (key, value) => { if (!(key in c)) Object.defineProperty(c, key, { value, writable: true, configurable: true, enumerable: true }); };
        define('app', {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails() { return null; },
          getIsInstalled() { return false; },
          runningState() { return 'cannot_run'; },
        });
        define('csi', function csi() {
          const n = nav();
          return { startE: Math.round(performance.timeOrigin), onloadT: Math.round(performance.timeOrigin + (n.domContentLoadedEventEnd || 0)), pageT: performance.now(), tran: 15 };
        });
        define('loadTimes', function loadTimes() {
          const n = nav();
          const t0 = performance.timeOrigin / 1000;
          const at = (ms) => (ms ? t0 + ms / 1000 : 0);
          const proto = n.nextHopProtocol || 'http/1.1';
          return {
            requestTime: at(n.requestStart), startLoadTime: t0, commitLoadTime: at(n.responseStart),
            finishDocumentLoadTime: at(n.domContentLoadedEventEnd), finishLoadTime: at(n.loadEventEnd),
            firstPaintTime: at((performance.getEntriesByName('first-paint')[0] || {}).startTime), firstPaintAfterLoadTime: 0,
            navigationType: 'Other', wasFetchedViaSpdy: proto === 'h2', wasNpnNegotiated: proto !== 'http/1.1',
            npnNegotiatedProtocol: proto === 'http/1.1' ? 'unknown' : proto, wasAlternateProtocolAvailable: false, connectionInfo: proto,
          };
        });
        if (!window.chrome) Object.defineProperty(window, 'chrome', { value: c, writable: true, configurable: true, enumerable: true });
      },
    });
  } catch {}
}

// Fingerprint protection. Sites that read your canvas, audio stack or hardware to build a
// fingerprint get slightly different answers per site and per session, so the readings can't
// follow you around. Lantern decides per site (Shields) and passes a seed; nothing leaves the device.
if ((location.protocol === 'https:' || location.protocol === 'http:') && contextBridge.executeInMainWorld) {
  let cfg = null;
  try { cfg = ipcRenderer.sendSync('lantern:fp', location.href); } catch {}
  if (cfg && cfg.on) {
    try {
      contextBridge.executeInMainWorld({
        args: [cfg],
        func: (conf) => {
          // A small generator seeded per site; every reading restarts it so repeated reads agree.
          const gen = (seed) => { let st = seed >>> 0 || 1; return () => { st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0; return st / 4294967296; }; };
          const rand = gen(conf.seed);
          // Wrapping with a Proxy keeps Function.prototype.toString answering "[native code]".
          const wrap = (obj, name, make) => {
            const orig = obj && obj[name];
            if (typeof orig !== 'function') return;
            const handler = make(orig);
            try { Object.defineProperty(obj, name, { value: new Proxy(orig, { apply: (target, self, args) => handler(target, self, args) }), writable: true, configurable: true }); } catch {}
          };
          const noisePixels = (data) => {
            // Nudge a few hundred pixels by one step: invisible, but it changes the fingerprint hash.
            const r = gen(conf.seed ^ data.length);
            const n = Math.min(data.length / 4, 400);
            for (let i = 0; i < n; i++) {
              const p = Math.floor(r() * (data.length / 4)) * 4 + Math.floor(r() * 3);
              data[p] = data[p] ^ 1;
            }
          };
          const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
          wrap(C2D, 'getImageData', (orig) => (target, self, args) => {
            const img = Reflect.apply(target, self, args);
            try { noisePixels(img.data); } catch {}
            return img;
          });
          const noisyCopy = (canvas) => {
            if (!canvas.width || !canvas.height || canvas.width * canvas.height > 4096 * 4096) return canvas;
            try {
              const copy = document.createElement('canvas');
              copy.width = canvas.width; copy.height = canvas.height;
              const cx = copy.getContext('2d');
              cx.drawImage(canvas, 0, 0);
              const img = cx.getImageData(0, 0, copy.width, copy.height); // already noisy through the wrapper
              cx.putImageData(img, 0, 0);
              return copy;
            } catch { return canvas; }
          };
          const CP = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
          wrap(CP, 'toDataURL', () => (target, self, args) => Reflect.apply(target, noisyCopy(self), args));
          wrap(CP, 'toBlob', () => (target, self, args) => Reflect.apply(target, noisyCopy(self), args));
          // Audio fingerprinting reads tiny float differences; add differences of the same size.
          const AB = window.AudioBuffer && AudioBuffer.prototype;
          wrap(AB, 'getChannelData', () => (target, self, args) => {
            const data = Reflect.apply(target, self, args);
            try { if (!self.__lanternFp) { self.__lanternFp = true; const r = gen(conf.seed ^ data.length); for (let i = 0; i < data.length; i += 97) data[i] += (r() - 0.5) * 1e-7; } } catch {}
            return data;
          });
          const AN = window.AnalyserNode && AnalyserNode.prototype;
          wrap(AN, 'getFloatFrequencyData', () => (target, self, args) => {
            const r = Reflect.apply(target, self, args);
            try { const a = args[0]; const r = gen(conf.seed ^ a.length); for (let i = 0; i < a.length; i += 7) a[i] += (r() - 0.5) * 1e-4; } catch {}
            return r;
          });
          // Hardware details: a plausible value that differs per site.
          const cores = conf.strict ? 4 : Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 2 + Math.floor(rand() * 7)));
          try { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => cores, configurable: true }); } catch {}
          try { if ('deviceMemory' in navigator) Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, configurable: true }); } catch {}
          // Battery level and charge times can identify a device for a while; answer with a full, charging battery.
          if (conf.strict && navigator.getBattery) {
            const fake = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener() {}, removeEventListener() {}, onchargingchange: null, onlevelchange: null };
            wrap(Navigator.prototype, 'getBattery', () => () => Promise.resolve(fake));
          }
          // Graphics card name: generic everywhere in strict mode.
          if (conf.strict) {
            for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
              if (!G) continue;
              wrap(G.prototype, 'getParameter', () => (target, self, args) => {
                if (args[0] === 0x9245) return 'Google Inc.';
                if (args[0] === 0x9246) return 'ANGLE (Generic, Lantern)';
                return Reflect.apply(target, self, args);
              });
            }
          }
        },
      });
    } catch {}
  }
}

// Lantern Search's local index: after a normal page finishes loading, its visible text goes to
// Lantern (on this computer only) so you can find it again later. Lantern decides whether to keep
// it (never for private windows, or with history or indexing turned off); pages with a password
// box are never sent at all.
if ((location.protocol === 'https:' || location.protocol === 'http:') && process.isMainFrame) {
  const sendText = () => {
    try {
      if (document.querySelector('input[type="password"]')) return;
      const body = document.body;
      if (!body) return;
      const text = (body.innerText || '').slice(0, 20000);
      if (text.length > 200) ipcRenderer.send('lantern:page-text', { text });
    } catch {}
  };
  window.addEventListener('load', () => setTimeout(sendText, 2500), { once: true });
}
