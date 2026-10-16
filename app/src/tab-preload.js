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
