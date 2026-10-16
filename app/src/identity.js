'use strict';
// How Lantern describes itself to websites.
//
// Google (and some other sites) turn away "embedded" browsers built on app frameworks, and
// they spot them by inconsistencies rather than by name. Out of the box an Electron browser:
//   1. sends its full engine build in the User-Agent (Chrome/152.0.7977.130), which no real
//      Chromium browser does since UA reduction (they send Chrome/152.0.0.0);
//   2. exposes navigator.userAgentData but sends no Sec-CH-UA headers to match it;
//   3. has an empty window.chrome object where Chromium browsers have app/loadTimes/csi.
// Lantern removes those three mismatches so it presents as what it is: a Chromium browser.
// It does not claim to be Google Chrome (no "Google Chrome" brand).

const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
const GREASE_VERSIONS = ['8', '99', '24'];

function chromeMajor(full = process.versions.chrome) {
  return Number(String(full || '').split('.')[0]) || 0;
}

// Chromium's "reduced" User-Agent: only the major version, everything else frozen.
function reducedUserAgent(ua, major = chromeMajor()) {
  return String(ua || '')
    .replace(/\s*Electron\/\S+/, '')
    .replace(/\s*lantern-browser\/\S+/i, '')
    .replace(/\s*Lantern\/\S+/, '')
    .replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`);
}

// The brand list Chromium itself generates (same GREASE algorithm, keyed on the major version),
// so headers agree with navigator.userAgentData.brands.
function brandList(major = chromeMajor()) {
  const grease = { brand: `Not${GREASE_CHARS[major % 11]}A${GREASE_CHARS[(major + 1) % 11]}Brand`, version: GREASE_VERSIONS[major % 3] };
  const chromium = { brand: 'Chromium', version: String(major) };
  return major % 2 === 0 ? [grease, chromium] : [chromium, grease];
}
function secChUa(major = chromeMajor()) {
  return brandList(major).map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
}
function platformName(p = process.platform) {
  return p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : p === 'linux' ? 'Linux' : 'Unknown';
}

// Chromium only sends client hints to secure origins (https, and localhost).
function wantsClientHints(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' || ((u.protocol === 'http:') && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname));
}

// Adds the low-entropy client hints a Chromium browser sends with every secure request.
function addClientHints(headers, url, major = chromeMajor(), platform = process.platform) {
  if (!wantsClientHints(url)) return headers;
  const has = (name) => Object.keys(headers).some((k) => k.toLowerCase() === name);
  if (!has('sec-ch-ua')) headers['sec-ch-ua'] = secChUa(major);
  if (!has('sec-ch-ua-mobile')) headers['sec-ch-ua-mobile'] = '?0';
  if (!has('sec-ch-ua-platform')) headers['sec-ch-ua-platform'] = `"${platformName(platform)}"`;
  return headers;
}

module.exports = { chromeMajor, reducedUserAgent, brandList, secChUa, platformName, wantsClientHints, addClientHints };
