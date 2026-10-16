'use strict';
const { addClientHints } = require('./identity');
// Privacy layer for one profile's session: tracker blocking, HTTPS-only, cookie isolation,
// Global Privacy Control, and site permissions.
const { webContents, dialog, BrowserWindow } = require('electron');

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
function siteOf(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const two = parts.slice(-2).join('.');
  if (/^(co|com|org|net|gov|ac|edu|ne|or)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join('.');
  return two;
}
function isLocalHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(host) || host.endsWith('.local') || host.endsWith('.test') || host.endsWith('.localhost');
}

const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const LABELS = { camera: 'camera', microphone: 'microphone', notifications: 'notifications', location: 'location' };

/**
 * @param {object} ctx  profile context: { session, settings, saveSettings(), getBlocker(), onBlocked(tabWebContentsId), tabFor(wcId) }
 */
function setupPrivacy(ctx) {
  const ses = ctx.session;
  const httpExempt = new Set(); // hosts that failed after an HTTPS upgrade this session

  function topSiteFor(details) {
    if (details.resourceType === 'mainFrame') return siteOf(hostOf(details.url));
    const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : null;
    return wc && !wc.isDestroyed() ? siteOf(hostOf(wc.getURL())) : '';
  }
  function isThirdParty(details) {
    if (details.resourceType === 'mainFrame') return false;
    const top = topSiteFor(details);
    return !!top && siteOf(hostOf(details.url)) !== top;
  }

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const { url, resourceType } = details;
    const s = ctx.settings;
    // Dangerous-site protection: known phishing and malware hosts never load.
    if (s.safeBrowsing && (resourceType === 'mainFrame' || resourceType === 'subFrame') && /^https?:/.test(url)) {
      const threats = ctx.getThreats();
      const kind = threats && threats.check(url);
      if (kind && !ctx.isBypassed(url)) {
        if (resourceType === 'mainFrame') ctx.onThreat(details.webContentsId, url, kind);
        return callback({ cancel: true });
      }
    }
    if (s.httpsOnly && url.startsWith('http://') && (resourceType === 'mainFrame' || resourceType === 'subFrame')) {
      const host = hostOf(url);
      if (!isLocalHost(host) && !httpExempt.has(host)) {
        const tab = ctx.tabFor(details.webContentsId);
        if (tab && resourceType === 'mainFrame') tab.upgradedFrom = url;
        return callback({ redirectURL: 'https://' + url.slice(7) });
      }
    }
    const blocker = ctx.getBlocker();
    if (s.blockTrackers && blocker && /^https?:/.test(url)) {
      return blocker.onBeforeRequest(details, (resp) => {
        if (resp.cancel || resp.redirectURL) ctx.onBlocked(details.webContentsId);
        callback(resp);
      });
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = details.requestHeaders;
    addClientHints(headers, details.url);
    if (ctx.settings.sendGpc) { headers['Sec-GPC'] = '1'; headers.DNT = '1'; }
    if (ctx.settings.blockThirdPartyCookies && isThirdParty(details)) delete headers.Cookie;
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    if (!ctx.settings.blockThirdPartyCookies || !isThirdParty(details) || !details.responseHeaders) return callback({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k];
    callback({ responseHeaders: headers });
  });

  // ----- permissions -----
  function kindsFor(permission, details = {}) {
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      const kinds = [];
      if (types.includes('video')) kinds.push('camera');
      if (types.includes('audio')) kinds.push('microphone');
      return kinds.length ? kinds : ['camera', 'microphone'];
    }
    if (permission === 'notifications') return ['notifications'];
    if (permission === 'geolocation') return ['location'];
    return null;
  }
  function remembered(origin, kind) {
    const site = ctx.settings.sitePermissions[origin];
    return site ? site[kind] : undefined;
  }

  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    const kinds = kindsFor(permission, details);
    if (!kinds) return callback(false);
    let origin;
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch { return callback(false); }
    const pending = [];
    for (const kind of kinds) {
      const mode = ctx.settings[kind];
      if (mode === 'block') return callback(false);
      const r = remembered(origin, kind);
      if (r === false) return callback(false);
      if (r !== true) pending.push(kind);
    }
    if (!pending.length) return callback(true);
    const win = BrowserWindow.fromWebContents(wc) || BrowserWindow.getFocusedWindow();
    const what = pending.map((k) => LABELS[k]).join(' and ');
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      message: `${hostOf(origin)} wants to use your ${what}`,
      checkboxLabel: 'Remember my choice for this site',
      checkboxChecked: true,
    });
    const allow = response === 0;
    if (checkboxChecked) {
      ctx.settings.sitePermissions[origin] = { ...(ctx.settings.sitePermissions[origin] || {}) };
      for (const k of pending) ctx.settings.sitePermissions[origin][k] = allow;
      ctx.saveSettings();
    }
    callback(allow);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return true;
    const kinds = kindsFor(permission === 'media' ? 'media' : permission, { mediaTypes: details && details.mediaType ? [details.mediaType] : [] });
    if (!kinds) return false;
    let origin;
    try { origin = new URL(requestingOrigin).origin; } catch { return false; }
    return kinds.every((k) => ctx.settings[k] !== 'block' && remembered(origin, k) === true);
  });

  return {
    httpExempt,
    noteFailedUpgrade(url) { httpExempt.add(hostOf(url)); },
  };
}

module.exports = { setupPrivacy, siteOf, hostOf };
