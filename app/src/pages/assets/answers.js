'use strict';
// Instant answers for Lantern's search boxes: sums, percentages, unit and Indian number
// conversions, time in a city, days until a date and colour codes. Worked out on the page;
// nothing you type is sent anywhere. Shared by the new tab page and Lantern Search.
(function (root) {
  var h24 = false;
  function fmtTime(d, tz) { var o = { hour: 'numeric', minute: '2-digit', hour12: !h24 }; if (tz) o.timeZone = tz; return d.toLocaleTimeString([], o); }
  function calc(src) {
    var s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
    if (!/^[\d.+\-*/^%()a-z]+$/.test(s) || !/[\d)]/.test(s)) return null;
    var i = 0, FN = { sqrt: Math.sqrt, sin: function (x) { return Math.sin(x * Math.PI / 180); }, cos: function (x) { return Math.cos(x * Math.PI / 180); }, tan: function (x) { return Math.tan(x * Math.PI / 180); }, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
    function peek() { return s[i]; }
    function num() {
      var m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      var w = /^[a-z]+/.exec(s.slice(i));
      if (w) {
        i += w[0].length;
        if (w[0] === 'pi') return Math.PI; if (w[0] === 'e') return Math.E;
        if (FN[w[0]] && peek() === '(') { i++; var v = expr(); if (peek() !== ')') throw 0; i++; return FN[w[0]](v); }
        throw 0;
      }
      if (peek() === '(') { i++; var x = expr(); if (peek() !== ')') throw 0; i++; return x; }
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '+') { i++; return factor(); }
      throw 0;
    }
    function factor() { var b = num(); while (peek() === '%') { i++; b = b / 100; } if (peek() === '^') { i++; return Math.pow(b, factor()); } return b; }
    function term() { var v = factor(); while (peek() === '*' || peek() === '/' || peek() === '(' || /[a-z]/.test(peek() || '')) { var op = peek(); if (op === '*' || op === '/') i++; var r = factor(); v = op === '/' ? v / r : v * r; } return v; }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var op = s[i++]; var r = term(); v = op === '+' ? v + r : v - r; } return v; }
    try { var out = expr(); if (i !== s.length || !isFinite(out)) return null; return out; } catch (e) { return null; }
  }
  function nice(n) {
    if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(6).replace(/\.?0+e/, 'e');
    return Number(n.toPrecision(12)).toLocaleString('en-IN', { maximumFractionDigits: 8 });
  }
  var UNITS = {
    mm: ['len', .001], cm: ['len', .01], m: ['len', 1], km: ['len', 1000], in: ['len', .0254], inch: ['len', .0254], inches: ['len', .0254], ft: ['len', .3048], feet: ['len', .3048], foot: ['len', .3048], yd: ['len', .9144], mi: ['len', 1609.344], mile: ['len', 1609.344], miles: ['len', 1609.344],
    mg: ['mass', .001], g: ['mass', 1], kg: ['mass', 1000], t: ['mass', 1e6], tonne: ['mass', 1e6], lb: ['mass', 453.59237], lbs: ['mass', 453.59237], pound: ['mass', 453.59237], pounds: ['mass', 453.59237], oz: ['mass', 28.349523125], tola: ['mass', 11.6638038],
    ml: ['vol', .001], l: ['vol', 1], litre: ['vol', 1], liter: ['vol', 1], gal: ['vol', 3.785411784], gallon: ['vol', 3.785411784], cup: ['vol', .2365882365], tsp: ['vol', .00492892159375], tbsp: ['vol', .01478676478125], floz: ['vol', .0295735295625],
    b: ['data', 1], kb: ['data', 1e3], mb: ['data', 1e6], gb: ['data', 1e9], tb: ['data', 1e12], kib: ['data', 1024], mib: ['data', 1048576], gib: ['data', 1073741824],
    s: ['time', 1], sec: ['time', 1], min: ['time', 60], h: ['time', 3600], hr: ['time', 3600], hours: ['time', 3600], day: ['time', 86400], days: ['time', 86400], week: ['time', 604800], weeks: ['time', 604800], year: ['time', 31557600], years: ['time', 31557600],
    kmh: ['speed', 1 / 3.6], 'km/h': ['speed', 1 / 3.6], mph: ['speed', .44704], 'm/s': ['speed', 1], knot: ['speed', .514444], knots: ['speed', .514444],
    sqft: ['area', .09290304], sqm: ['area', 1], acre: ['area', 4046.8564224], acres: ['area', 4046.8564224], hectare: ['area', 1e4], ha: ['area', 1e4], cent: ['area', 40.468564224], cents: ['area', 40.468564224],
    c: ['temp'], '°c': ['temp'], celsius: ['temp'], f: ['temp'], '°f': ['temp'], fahrenheit: ['temp'], k: ['temp'], kelvin: ['temp'],
    lakh: ['count', 1e5], lakhs: ['count', 1e5], crore: ['count', 1e7], crores: ['count', 1e7], thousand: ['count', 1e3], million: ['count', 1e6], millions: ['count', 1e6], billion: ['count', 1e9], billions: ['count', 1e9]
  };
  function toK(v, u) { u = u.replace('°', ''); return u[0] === 'c' ? v + 273.15 : u[0] === 'f' ? (v - 32) * 5 / 9 + 273.15 : v; }
  function fromK(v, u) { u = u.replace('°', ''); return u[0] === 'c' ? v - 273.15 : u[0] === 'f' ? (v - 273.15) * 9 / 5 + 32 : v; }
  var CITIES = {
    kochi: 'Asia/Kolkata', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata', chennai: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', india: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata',
    dubai: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', doha: 'Asia/Qatar', riyadh: 'Asia/Riyadh', kuwait: 'Asia/Kuwait', muscat: 'Asia/Muscat',
    london: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', madrid: 'Europe/Madrid', rome: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', zurich: 'Europe/Zurich', moscow: 'Europe/Moscow', istanbul: 'Europe/Istanbul',
    'new york': 'America/New_York', nyc: 'America/New_York', toronto: 'America/Toronto', chicago: 'America/Chicago', denver: 'America/Denver', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles', vancouver: 'America/Vancouver', 'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
    tokyo: 'Asia/Tokyo', seoul: 'Asia/Seoul', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', singapore: 'Asia/Singapore', 'kuala lumpur': 'Asia/Kuala_Lumpur', bangkok: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', manila: 'Asia/Manila', dhaka: 'Asia/Dhaka', karachi: 'Asia/Karachi', kathmandu: 'Asia/Kathmandu', colombo: 'Asia/Colombo',
    sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', perth: 'Australia/Perth', auckland: 'Pacific/Auckland', nairobi: 'Africa/Nairobi', cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', johannesburg: 'Africa/Johannesburg', utc: 'UTC', gmt: 'UTC'
  };
  function cap(s) { return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function answer(text) {
    var t = text.trim().toLowerCase(), m;
    if (!t || t[0] === '!') return null;
    if ((m = /^(?:what(?:'s| is) the )?time (?:in|at) ([a-z .]+)\??$/.exec(t)) && CITIES[m[1].trim()]) {
      var tz = CITIES[m[1].trim()], d = new Date();
      return { eq: 'Time in ' + cap(m[1].trim()), val: fmtTime(d, tz), note: d.toLocaleDateString([], { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' }) + ' · ' + tz.replace('_', ' ') };
    }
    if ((m = /^(-?[\d.,]+)\s*%\s*of\s*(-?[\d.,]+)$/.exec(t))) { var p = parseFloat(m[1].replace(/,/g, '')) / 100 * parseFloat(m[2].replace(/,/g, '')); return { eq: m[1] + '% of ' + m[2], val: nice(p) }; }
    if ((m = /^(-?[\d.,]+)\s*([a-z°/]+)\s+(?:to|in|into|as)\s+([a-z°/]+)$/.exec(t.replace(/\s*(sq)\s+(ft|m)\b/g, '$1$2').replace(/fl oz/g, 'floz')))) {
      var v = parseFloat(m[1].replace(/,/g, '')), a = UNITS[m[2]], b = UNITS[m[3]];
      if (a && b && a[0] === b[0]) {
        var r = a[0] === 'temp' ? fromK(toK(v, m[2]), m[3]) : v * a[1] / b[1];
        return { eq: m[1] + ' ' + m[2] + ' =', val: nice(r) + ' ' + m[3], note: a[0] === 'data' ? '1 KB = 1000 bytes; use KiB for 1024.' : a[0] === 'area' && /cent/.test(m[2] + m[3]) ? '1 cent = 435.6 sq ft, as used in Kerala land records.' : null };
      }
    }
    if ((m = /^(?:days? (?:until|till|to)|how long until) (.+)$/.exec(t))) {
      var now = new Date(), target = new Date(m[1]);
      if (!/\d{4}/.test(m[1])) {
        target = new Date(m[1] + ' ' + now.getFullYear());
        if (!isNaN(target) && new Date(target.getFullYear(), target.getMonth(), target.getDate()) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) target.setFullYear(now.getFullYear() + 1);
      }
      if (!isNaN(target)) { var days = Math.ceil((new Date(target.getFullYear(), target.getMonth(), target.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5); return { eq: 'Until ' + target.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }), val: days + (Math.abs(days) === 1 ? ' day' : ' days'), note: Math.round(days / 7 * 10) / 10 + ' weeks' }; }
    }
    if ((m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(t)) && /^#/.test(text.trim())) {
      var hx = m[1].length === 3 ? m[1].split('').map(function (c) { return c + c; }).join('') : m[1], n = parseInt(hx, 16);
      return { eq: 'Colour #' + hx, val: 'rgb(' + (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255) + ')', swatch: '#' + hx };
    }
    if (/[\d)]\s*[-+*/^×÷%]|^(sqrt|sin|cos|tan|log|ln)\(|\bpi\b/.test(t) && !/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(t)) {
      var c = calc(t); if (c !== null) return { eq: text.trim() + ' =', val: nice(c), note: /sin|cos|tan/.test(t) ? 'Angles in degrees.' : null };
    }
    return null;
  }
  root.LanternAnswers = { answer: answer, calc: calc, setClock24: function (on) { h24 = !!on; }, cities: CITIES };
})(typeof window !== 'undefined' ? window : globalThis);
