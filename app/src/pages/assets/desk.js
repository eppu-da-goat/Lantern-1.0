'use strict';
// Your desk on the New Tab page: focus timer with focus sounds, tasks, sticky notes, world clocks,
// a calendar, countdowns and a toolbox (clean link, password, QR code, text), plus instant answers
// under the search box and keyboard shortcuts. Everything is kept in this profile on this computer.
(() => {
  const api = window.lantern;
  const root = document.getElementById('desk');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const KEY = 'lantern-desk-v1';
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids || []) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  // ---------------------------------------------------------- state
  const DEFAULTS = {
    show: true, h24: false,
    widgets: { timer: true, tasks: true, notes: true, world: true, cal: true, count: true, tools: true },
    tasks: [{ id: 1, text: 'Try the focus timer', done: false }],
    notes: [{ id: 1, color: 'sun', text: 'Notes stay in this profile, on this computer.' }],
    zones: ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Dubai'],
    countdowns: [{ id: 1, name: 'New Year', date: `${new Date().getFullYear() + 1}-01-01` }],
    timer: { done: 0, day: '' },
  };
  let S;
  try { S = { ...structuredClone(DEFAULTS), ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch { S = structuredClone(DEFAULTS); }
  S.widgets = { ...DEFAULTS.widgets, ...(S.widgets || {}) };
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }, 150); };
  let toastT = null;
  function toast(t) { const x = $('desk-toast'); x.textContent = t; x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { x.hidden = true; }, 2400); }
  const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Couldn’t copy. Select the text and press Ctrl+C.'));

  // ---------------------------------------------------------- markup
  root.innerHTML = `
    <div class="desk-head"><h2>Your desk</h2><span class="desk-note">Kept in this profile, on this computer</span>
      <button type="button" class="desk-btn" id="desk-keys" title="Keyboard shortcuts (?)">Shortcuts <kbd>?</kbd></button></div>
    <div class="desk-grid">
      <article class="w" data-w="timer">
        <div class="w-head"><h3>Focus timer</h3><span class="meta" id="t-count"></span></div>
        <div class="timer">
          <div class="ring"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="prog" id="t-prog" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="0"/></svg><div class="time"><span id="t-left">25:00</span><small id="t-phase">FOCUS</small></div></div>
          <div class="ctrl">
            <div class="seg" role="radiogroup" aria-label="Timer length">
              <label><input type="radio" name="tlen" value="25" checked><span>Focus</span></label>
              <label><input type="radio" name="tlen" value="5"><span>Break</span></label>
              <label><input type="radio" name="tlen" value="15"><span>Long</span></label>
            </div>
            <div class="row"><button class="desk-go" id="t-start" type="button">Start</button><button class="desk-btn" id="t-reset" type="button">Reset</button></div>
          </div>
        </div>
        <div class="sounds" id="snd"><span class="label">Sounds</span>
          <button type="button" class="desk-btn sm" data-snd="rain" aria-pressed="false">Rain</button>
          <button type="button" class="desk-btn sm" data-snd="brown" aria-pressed="false">Deep hum</button>
          <button type="button" class="desk-btn sm" data-snd="waves" aria-pressed="false">Waves</button>
          <input type="range" id="snd-vol" min="0" max="100" value="40" aria-label="Sound volume">
        </div>
      </article>
      <article class="w" data-w="tasks">
        <div class="w-head"><h3>Tasks</h3><span class="meta" id="tk-meta"></span><button class="desk-btn sm" id="tk-clear" type="button">Clear done</button></div>
        <form id="tk-form"><input class="in" id="tk-in" placeholder="Add a task and press Enter" aria-label="New task"></form>
        <ul class="tasks" id="tk-list"></ul>
      </article>
      <article class="w" data-w="notes">
        <div class="w-head"><h3>Sticky notes</h3><button class="desk-btn sm" id="nt-add" type="button">New note</button></div>
        <div class="notes" id="nt-list"></div>
      </article>
      <article class="w" data-w="world">
        <div class="w-head"><h3>World clocks</h3></div>
        <div class="clocks" id="wc-list"></div>
        <select class="in" id="wc-add" aria-label="Add a city"><option value="">Add a city…</option></select>
      </article>
      <article class="w" data-w="cal">
        <div class="w-head"><h3 id="cal-title">Calendar</h3><button class="desk-btn sm" id="cal-prev" type="button" aria-label="Previous month">‹</button><button class="desk-btn sm" id="cal-today" type="button">Today</button><button class="desk-btn sm" id="cal-next" type="button" aria-label="Next month">›</button></div>
        <div class="cal" id="cal"></div>
        <p class="desk-note" id="cal-foot"></p>
      </article>
      <article class="w" data-w="count">
        <div class="w-head"><h3>Countdowns</h3><button class="desk-btn sm" id="cd-toggle" type="button">Add</button></div>
        <form id="cd-form" class="row" hidden><input class="in" id="cd-name" placeholder="What's happening" maxlength="60" aria-label="Event"><input class="in" id="cd-date" type="date" aria-label="Date"><button class="desk-btn sm" type="submit">Add</button></form>
        <div id="cd-list"></div>
      </article>
      <article class="w" data-w="tools">
        <div class="w-head"><h3>Toolbox</h3></div>
        <div class="tabs" role="tablist" aria-label="Tools">
          <button role="tab" data-tool="clean" aria-selected="true">Clean link</button>
          <button role="tab" data-tool="pw" aria-selected="false">Password</button>
          <button role="tab" data-tool="qr" aria-selected="false">QR code</button>
          <button role="tab" data-tool="text" aria-selected="false">Text</button>
        </div>
        <div data-pane="clean" class="pane">
          <input class="in" id="cl-in" placeholder="Paste a link to remove tracking codes" spellcheck="false" aria-label="Link to clean">
          <div class="tool-out" id="cl-out">Removes utm_, fbclid, gclid, si and other trackers, using Lantern's own cleaner.</div>
          <div class="row"><button class="desk-btn sm" id="cl-copy" type="button">Copy clean link</button><span class="desk-note" id="cl-status"></span></div>
        </div>
        <div data-pane="pw" class="pane" hidden>
          <div class="tool-out pw" id="pw-out"></div>
          <div class="meter"><i id="pw-meter"></i></div>
          <label class="row">Length <input type="range" id="pw-len" min="8" max="64" value="20"> <b id="pw-len-v">20</b></label>
          <div class="row checks"><label><input type="checkbox" id="pw-sym" checked> Symbols</label><label><input type="checkbox" id="pw-easy"> No look-alikes</label><span class="desk-note" id="pw-strength"></span></div>
          <div class="row"><button class="desk-go" id="pw-new" type="button">New password</button><button class="desk-btn sm" id="pw-copy" type="button">Copy</button></div>
        </div>
        <div data-pane="qr" class="pane" hidden>
          <input class="in" id="qr-in" placeholder="A link or any text" spellcheck="false" aria-label="Text for the QR code">
          <div class="qr" id="qr-out"><span>Type something to make a code you can scan with your phone.</span></div>
        </div>
        <div data-pane="text" class="pane" hidden>
          <textarea class="in" id="tx-in" rows="4" placeholder="Paste or type text" aria-label="Text"></textarea>
          <div class="stats"><div><b id="tx-w">0</b><span>words</span></div><div><b id="tx-c">0</b><span>characters</span></div><div><b id="tx-r">0m</b><span>to read</span></div></div>
          <div class="row"><button class="desk-btn sm" data-tx="upper" type="button">UPPER</button><button class="desk-btn sm" data-tx="lower" type="button">lower</button><button class="desk-btn sm" data-tx="title" type="button">Title Case</button><button class="desk-btn sm" data-tx="spaces" type="button">Tidy spaces</button></div>
        </div>
      </article>
    </div>
    <div class="desk-veil" id="keys-veil" hidden></div>
    <div class="keys-sheet" id="keys-sheet" role="dialog" aria-modal="true" aria-labelledby="keys-h" hidden>
      <div class="w-head"><h3 id="keys-h">Keyboard shortcuts</h3><button class="desk-btn sm" id="keys-close" type="button">Close</button></div>
      <div class="keys" id="keys-list"></div>
    </div>
    <div class="desk-toast" id="desk-toast" role="status" hidden></div>`;

  function applyWidgets() {
    root.hidden = !S.show;
    root.querySelectorAll('[data-w]').forEach((w) => { w.hidden = !S.widgets[w.dataset.w]; });
  }

  // ---------------------------------------------------------- instant answers under the search box
  const q = $('q');
  const answerBox = el('div', { class: 'instant', id: 'instant', role: 'status', hidden: true });
  const form = $('search');
  if (form && q) {
    form.after(answerBox);
    q.addEventListener('input', () => {
      const a = window.LanternAnswers ? window.LanternAnswers.answer(q.value) : null;
      answerBox.textContent = '';
      if (!a) { answerBox.hidden = true; return; }
      if (a.swatch) answerBox.append(el('span', { class: 'swatch', style: `background:${a.swatch}` }));
      answerBox.append(el('span', { class: 'eq', text: a.eq }), el('b', { text: a.val }),
        el('button', { type: 'button', class: 'desk-btn sm', text: 'Copy', onclick: () => copy(a.val.replace(/\s[a-z°/]+$/i, '').replace(/,/g, ''), `Copied ${a.val}`) }));
      if (a.note) answerBox.append(el('span', { class: 'note', text: a.note }));
      answerBox.hidden = false;
    });
  }

  // ---------------------------------------------------------- focus timer + sounds
  const T = { len: 1500, left: 1500, end: 0, running: false, iv: 0 };
  const CIRC = 2 * Math.PI * 52;
  let actx = null;
  function tPaint() {
    const m = Math.floor(T.left / 60), s = T.left % 60;
    $('t-left').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('t-prog').style.strokeDashoffset = String(CIRC * (1 - T.left / T.len));
    $('t-phase').textContent = T.len === 1500 ? 'FOCUS' : T.len === 300 ? 'BREAK' : 'LONG BREAK';
    $('t-start').textContent = T.running ? 'Pause' : T.left < T.len ? 'Resume' : 'Start';
    if (S.timer.day !== today()) S.timer = { done: 0, day: today() };
    $('t-count').textContent = `${S.timer.done} today`;
  }
  function chime() {
    if (!actx) return;
    [0, 0.18, 0.36].forEach((d, i) => {
      const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = [660, 880, 990][i];
      g.gain.setValueAtTime(0.0001, actx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d + 0.5);
      o.connect(g).connect(actx.destination); o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.55);
    });
  }
  function tStep() {
    T.left = Math.max(0, Math.round((T.end - Date.now()) / 1000));
    if (T.left <= 0) {
      clearInterval(T.iv); T.running = false;
      if (T.len === 1500) { S.timer.done++; save(); }
      chime(); toast(T.len === 1500 ? 'Focus session done. Take a break.' : 'Break over.');
      document.title = 'New Tab';
      setTimeout(() => { T.left = T.len; tPaint(); }, 1500);
    } else document.title = `${$('t-left').textContent} · Focus`;
    tPaint();
  }
  function tToggle() {
    try { if (!actx) actx = new AudioContext(); if (actx.state === 'suspended') actx.resume(); } catch {}
    if (T.running) { clearInterval(T.iv); T.running = false; document.title = 'New Tab'; }
    else { if (T.left <= 0) T.left = T.len; T.end = Date.now() + T.left * 1000; T.running = true; T.iv = setInterval(tStep, 500); }
    tPaint();
  }
  function tReset() { clearInterval(T.iv); T.running = false; T.left = T.len; document.title = 'New Tab'; tPaint(); }
  $('t-start').addEventListener('click', tToggle);
  $('t-reset').addEventListener('click', tReset);
  root.querySelectorAll('input[name="tlen"]').forEach((r) => r.addEventListener('change', () => { T.len = +r.value * 60; tReset(); }));

  const SND = { src: null, gain: null, kind: '' };
  function noise(ctx, kind) {
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown' || kind === 'waves') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926; }
      }
    }
    return buf;
  }
  function sndStop() { if (SND.src) { try { SND.src.stop(); } catch {} SND.src = null; } SND.kind = ''; sndPaint(); }
  function sndToggle(kind) {
    if (SND.kind === kind) { sndStop(); return; }
    sndStop();
    try {
      if (!actx) actx = new AudioContext();
      if (actx.state === 'suspended') actx.resume();
      if (!SND.gain) { SND.gain = actx.createGain(); SND.gain.connect(actx.destination); }
      const src = actx.createBufferSource(); src.buffer = noise(actx, kind); src.loop = true;
      let node = src;
      if (kind === 'rain') { const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400; node.connect(hp); node = hp; }
      if (kind === 'waves') {
        const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; node.connect(lp);
        const swell = actx.createGain(), lfo = actx.createOscillator(), depth = actx.createGain();
        lfo.frequency.value = 0.11; depth.gain.value = 0.45; swell.gain.value = 0.55; lfo.connect(depth).connect(swell.gain); lfo.start();
        lp.connect(swell); node = swell;
      }
      node.connect(SND.gain);
      SND.gain.gain.value = (+$('snd-vol').value / 100) * 0.6;
      src.start(); SND.src = src; SND.kind = kind; sndPaint();
    } catch { toast('Sounds can’t play here.'); }
  }
  function sndPaint() { root.querySelectorAll('[data-snd]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snd === SND.kind))); }
  root.querySelectorAll('[data-snd]').forEach((b) => b.addEventListener('click', () => sndToggle(b.dataset.snd)));
  $('snd-vol').addEventListener('input', () => { if (SND.gain) SND.gain.gain.value = (+$('snd-vol').value / 100) * 0.6; });

  // ---------------------------------------------------------- tasks
  function renderTasks() {
    const ul = $('tk-list'); ul.textContent = '';
    for (const t of S.tasks) {
      const cb = el('input', { type: 'checkbox', 'aria-label': t.text }); cb.checked = !!t.done;
      cb.addEventListener('change', () => { t.done = cb.checked; save(); renderTasks(); });
      ul.append(el('li', { class: t.done ? 'done' : '' }, [cb, el('span', { text: t.text }), el('button', { class: 'x', type: 'button', 'aria-label': 'Delete task', text: '×', onclick: () => { S.tasks = S.tasks.filter((x) => x !== t); save(); renderTasks(); } })]));
    }
    if (!S.tasks.length) ul.append(el('li', { class: 'empty', text: 'Nothing on the list.' }));
    const left = S.tasks.filter((t) => !t.done).length;
    $('tk-meta').textContent = S.tasks.length ? `${left} left` : '';
  }
  $('tk-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('tk-in').value.trim(); if (!v) return; S.tasks.push({ id: Date.now(), text: v.slice(0, 200), done: false }); $('tk-in').value = ''; save(); renderTasks(); });
  $('tk-clear').addEventListener('click', () => { S.tasks = S.tasks.filter((t) => !t.done); save(); renderTasks(); });

  // ---------------------------------------------------------- notes
  const NOTE = { sun: '#fde68a', mint: '#bbf7d0', sky: '#bae6fd', rose: '#fecdd3', lilac: '#e9d5ff' };
  function renderNotes() {
    const box = $('nt-list'); box.textContent = '';
    for (const n of S.notes) {
      const ta = el('textarea', { 'aria-label': 'Note', placeholder: 'Write anything…', id: `note-${n.id}` }); ta.value = n.text;
      ta.addEventListener('input', () => { n.text = ta.value; save(); });
      const bar = el('div', { class: 'nbar' }, Object.keys(NOTE).map((c) => el('button', { type: 'button', 'aria-label': `${c} colour`, style: `background:${NOTE[c]}`, onclick: () => { n.color = c; save(); renderNotes(); } })));
      bar.append(el('button', { type: 'button', class: 'del', text: 'Delete', onclick: () => { S.notes = S.notes.filter((x) => x !== n); save(); renderNotes(); } }));
      box.append(el('div', { class: 'note', style: `background:${NOTE[n.color] || NOTE.sun}` }, [ta, bar]));
    }
    if (!S.notes.length) box.append(el('p', { class: 'empty', text: 'No notes yet.' }));
  }
  function newNote() { const keys = Object.keys(NOTE); const n = { id: Date.now(), color: keys[S.notes.length % keys.length], text: '' }; S.notes.unshift(n); save(); renderNotes(); const t = $(`note-${n.id}`); if (t) t.focus(); }
  $('nt-add').addEventListener('click', newNote);

  // ---------------------------------------------------------- world clocks
  const ZONES = [['Kochi', 'Asia/Kolkata'], ['London', 'Europe/London'], ['New York', 'America/New_York'], ['Dubai', 'Asia/Dubai'], ['Tokyo', 'Asia/Tokyo'], ['Singapore', 'Asia/Singapore'], ['Sydney', 'Australia/Sydney'], ['Los Angeles', 'America/Los_Angeles'], ['Toronto', 'America/Toronto'], ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'], ['Doha', 'Asia/Qatar'], ['Riyadh', 'Asia/Riyadh'], ['Muscat', 'Asia/Muscat'], ['Kuwait', 'Asia/Kuwait'], ['Hong Kong', 'Asia/Hong_Kong'], ['Seoul', 'Asia/Seoul'], ['Bangkok', 'Asia/Bangkok'], ['Kathmandu', 'Asia/Kathmandu'], ['Colombo', 'Asia/Colombo'], ['Nairobi', 'Africa/Nairobi'], ['São Paulo', 'America/Sao_Paulo'], ['Auckland', 'Pacific/Auckland'], ['UTC', 'UTC']];
  const zoneName = (z) => (ZONES.find((x) => x[1] === z) || [z.split('/').pop().replace(/_/g, ' ')])[0];
  const offsetMin = (tz, d) => Math.round((new Date(d.toLocaleString('en-US', { timeZone: tz })) - new Date(d.toLocaleString('en-US'))) / 60000);
  function renderClocks() {
    const d = new Date(), box = $('wc-list'); box.textContent = '';
    for (const z of S.zones) {
      const off = offsetMin(z, d);
      const rel = off === 0 ? 'Same time' : `${off > 0 ? '+' : '−'}${Math.floor(Math.abs(off) / 60)}h${Math.abs(off) % 60 ? ` ${Math.abs(off) % 60}m` : ''}`;
      box.append(el('div', { class: 'c' }, [el('div', { class: 'city' }, [zoneName(z), el('small', { text: rel })]),
        el('span', { class: 'tm', text: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.h24, timeZone: z }) }),
        el('button', { class: 'x', type: 'button', 'aria-label': `Remove ${zoneName(z)}`, text: '×', onclick: () => { S.zones = S.zones.filter((x) => x !== z); save(); renderClocks(); } })]));
    }
  }
  for (const z of ZONES) $('wc-add').append(el('option', { value: z[1], text: z[0] }));
  $('wc-add').addEventListener('change', (e) => { const v = e.target.value; if (v && !S.zones.includes(v)) { S.zones.push(v); save(); renderClocks(); } e.target.value = ''; });

  // ---------------------------------------------------------- calendar
  let calBase = new Date(); calBase.setDate(1);
  const HOLIDAYS = { '1-1': 'New Year', '1-26': 'Republic Day', '8-15': 'Independence Day', '10-2': 'Gandhi Jayanti', '11-1': 'Kerala Piravi', '12-25': 'Christmas' };
  const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); };
  function renderCal() {
    const box = $('cal'); box.textContent = '';
    const y = calBase.getFullYear(), mo = calBase.getMonth(), now = new Date();
    $('cal-title').textContent = calBase.toLocaleDateString([], { month: 'long', year: 'numeric' });
    box.append(el('span', { class: 'h', text: 'Wk' }));
    for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) box.append(el('span', { class: 'h', text: d }));
    const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
    const notes = [];
    for (let w = 0; w < 6; w++) {
      const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7);
      if (w === 5 && ws.getMonth() !== mo) break;
      box.append(el('span', { class: 'wk', text: isoWeek(ws) }));
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
        const hol = HOLIDAYS[`${d.getMonth() + 1}-${d.getDate()}`];
        if (hol && d.getMonth() === mo) notes.push(`${d.getDate()} ${hol}`);
        box.append(el('span', { class: `d${d.getMonth() !== mo ? ' out' : ''}${i >= 5 ? ' we' : ''}${d.toDateString() === now.toDateString() ? ' today' : ''}`, title: hol || null, text: d.getDate() }));
      }
    }
    $('cal-foot').textContent = `${notes.length ? `${notes.join(' · ')} · ` : ''}week ${isoWeek(now)} · ${Math.ceil((new Date(now.getFullYear(), 11, 31) - now) / 864e5)} days left in ${now.getFullYear()}`;
  }
  $('cal-prev').addEventListener('click', () => { calBase.setMonth(calBase.getMonth() - 1); renderCal(); });
  $('cal-next').addEventListener('click', () => { calBase.setMonth(calBase.getMonth() + 1); renderCal(); });
  $('cal-today').addEventListener('click', () => { calBase = new Date(); calBase.setDate(1); renderCal(); });

  // ---------------------------------------------------------- countdowns
  function renderCountdowns() {
    const box = $('cd-list'); box.textContent = '';
    const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const list = S.countdowns.map((c) => { const [y, m, d] = c.date.split('-').map(Number); const dt = new Date(y, m - 1, d); return { c, dt, days: Math.round((dt - t0) / 864e5) }; })
      .sort((a, b) => (a.days < 0) - (b.days < 0) || a.days - b.days);
    for (const x of list) {
      box.append(el('div', { class: 'cd' }, [el('div', { class: 'nm' }, [x.c.name, el('small', { text: x.dt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) })]),
        el('div', { class: 'left' }, [x.days === 0 ? 'Today' : String(Math.abs(x.days)), el('small', { text: x.days === 0 ? '' : x.days > 0 ? (x.days === 1 ? 'day' : 'days') : 'days ago' })]),
        el('button', { class: 'x', type: 'button', 'aria-label': `Remove ${x.c.name}`, text: '×', onclick: () => { S.countdowns = S.countdowns.filter((y) => y !== x.c); save(); renderCountdowns(); } })]));
    }
    if (!list.length) box.append(el('p', { class: 'empty', text: 'Count down to exams, trips, birthdays.' }));
  }
  $('cd-toggle').addEventListener('click', () => { $('cd-form').hidden = !$('cd-form').hidden; if (!$('cd-form').hidden) $('cd-name').focus(); });
  $('cd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('cd-name').value.trim(), d = $('cd-date').value;
    if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('Give it a name and a date.'); return; }
    S.countdowns.push({ id: Date.now(), name: n, date: d }); save(); renderCountdowns();
    $('cd-name').value = ''; $('cd-date').value = ''; $('cd-form').hidden = true;
  });

  // ---------------------------------------------------------- toolbox
  function tool(t) {
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tool === t)));
    root.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
    if (t === 'pw' && !$('pw-out').textContent) makePw();
  }
  root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => tool(b.dataset.tool)));
  let cleaned = '';
  $('cl-in').addEventListener('input', async () => {
    const v = $('cl-in').value.trim();
    cleaned = '';
    if (!/^https?:\/\//i.test(v)) { $('cl-out').textContent = v ? 'Paste a full link, starting with https://' : 'Removes utm_, fbclid, gclid, si and other trackers, using Lantern\'s own cleaner.'; $('cl-status').textContent = ''; return; }
    try {
      const r = api ? await api.cleanUrl(v) : { url: v, removed: [] };
      cleaned = r.url; $('cl-out').textContent = r.url;
      $('cl-status').textContent = r.removed && r.removed.length ? `Removed ${r.removed.length}: ${r.removed.join(', ')}` : 'Already clean.';
    } catch { $('cl-out').textContent = v; }
  });
  $('cl-copy').addEventListener('click', () => { if (cleaned) copy(cleaned, 'Clean link copied'); else $('cl-in').focus(); });
  function rnd(n) { const a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n; do crypto.getRandomValues(a); while (a[0] >= lim); return a[0] % n; }
  function makePw() {
    const easy = $('pw-easy').checked;
    const sets = ['abcdefghijkmnopqrstuvwxyz' + (easy ? '' : 'l'), 'ABCDEFGHJKLMNPQRSTUVWXYZ' + (easy ? '' : 'IO'), '23456789' + (easy ? '' : '01')];
    if ($('pw-sym').checked) sets.push('!@#$%^&*-_=+?');
    const len = +$('pw-len').value, all = sets.join(''), out = sets.map((s) => s[rnd(s.length)]);
    while (out.length < len) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    $('pw-out').textContent = out.join('');
    const bits = Math.round(len * Math.log2(all.length));
    $('pw-meter').style.width = `${Math.min(100, bits / 1.28)}%`;
    $('pw-strength').textContent = `${bits} bits · ${bits < 50 ? 'weak' : bits < 80 ? 'good' : bits < 110 ? 'strong' : 'very strong'}`;
  }
  ['pw-sym', 'pw-easy'].forEach((id) => $(id).addEventListener('change', makePw));
  $('pw-len').addEventListener('input', () => { $('pw-len-v').textContent = $('pw-len').value; makePw(); });
  $('pw-new').addEventListener('click', makePw);
  $('pw-copy').addEventListener('click', () => copy($('pw-out').textContent, 'Password copied'));
  let qrT = null;
  $('qr-in').addEventListener('input', () => {
    clearTimeout(qrT);
    qrT = setTimeout(async () => {
      const v = $('qr-in').value, box = $('qr-out');
      if (!v.trim()) { box.innerHTML = '<span>Type something to make a code you can scan with your phone.</span>'; return; }
      try { box.innerHTML = api ? await api.qr(v) : ''; } catch (err) { box.textContent = String(err.message || err).replace(/^.*Error: /, ''); }
    }, 150);
  });
  const txStats = () => { const t = $('tx-in').value, w = (t.match(/[\p{L}\p{N}'’-]+/gu) || []).length; $('tx-w').textContent = w.toLocaleString(); $('tx-c').textContent = t.length.toLocaleString(); $('tx-r').textContent = `${Math.ceil(w / 220)}m`; };
  $('tx-in').addEventListener('input', txStats);
  root.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => {
    const ta = $('tx-in'); let t = ta.value; const k = b.dataset.tx;
    if (k === 'upper') t = t.toUpperCase(); else if (k === 'lower') t = t.toLowerCase();
    else if (k === 'title') t = t.toLowerCase().replace(/(^|[\s(["'“‘-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
    else t = t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    ta.value = t; txStats();
  }));

  // ---------------------------------------------------------- keyboard shortcuts
  const KEYS = [
    ['Search box', '/'], ['Open shortcut 1 to 9', '1–9'], ['New task', 'T'], ['New sticky note', 'N'], ['Start or pause the focus timer', 'F'],
    ['Reset the timer', 'R'], ['Clean a link', 'L'], ['New password', 'P'], ['QR code', 'Q'], ['Rain sounds on or off', 'S'], ['This list', '?'],
    ['Summary search', 'Alt', 'Enter'], ['Site search with a bang', '!w', 'words'],
  ];
  function openKeys() {
    const list = $('keys-list'); list.textContent = '';
    for (const k of KEYS) list.append(el('div', { class: 'k' }, [el('span', { text: k[0] }), el('span', {}, k.slice(1).map((x) => el('kbd', { text: x })))]));
    $('keys-veil').hidden = false; $('keys-sheet').hidden = false; $('keys-close').focus();
  }
  function closeKeys() { $('keys-veil').hidden = true; $('keys-sheet').hidden = true; }
  $('desk-keys').addEventListener('click', openKeys);
  $('keys-close').addEventListener('click', closeKeys);
  $('keys-veil').addEventListener('click', closeKeys);
  const show = (w) => { S.widgets[w] = true; S.show = true; applyWidgets(); root.querySelector(`[data-w="${w}"]`).scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('keys-sheet').hidden) { closeKeys(); return; }
    const a = document.activeElement;
    if ((a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable)) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.panel:not([hidden]), .sc-dialog:not([hidden])')) return;
    const k = e.key.toLowerCase();
    if (e.key === '/') { e.preventDefault(); q && q.focus(); }
    else if (e.key === '?') { e.preventDefault(); openKeys(); }
    else if (/^[1-9]$/.test(e.key)) { const tiles = document.querySelectorAll('#shortcuts a.tile'); const t = tiles[+e.key - 1]; if (t) { e.preventDefault(); location.href = t.href; } }
    else if (k === 't') { e.preventDefault(); show('tasks'); $('tk-in').focus(); }
    else if (k === 'n') { e.preventDefault(); show('notes'); newNote(); }
    else if (k === 'f') { e.preventDefault(); show('timer'); tToggle(); }
    else if (k === 'r') { e.preventDefault(); tReset(); }
    else if (k === 'l') { e.preventDefault(); show('tools'); tool('clean'); $('cl-in').focus(); }
    else if (k === 'p') { e.preventDefault(); show('tools'); tool('pw'); makePw(); }
    else if (k === 'q') { e.preventDefault(); show('tools'); tool('qr'); $('qr-in').focus(); }
    else if (k === 's') { e.preventDefault(); sndToggle('rain'); }
  });

  // ---------------------------------------------------------- customize hooks (used by the Customize panel)
  window.LanternDesk = {
    state: () => S,
    setShow(on) { S.show = !!on; save(); applyWidgets(); },
    setWidget(w, on) { S.widgets[w] = !!on; save(); applyWidgets(); },
    widgets: [['timer', 'Focus timer'], ['tasks', 'Tasks'], ['notes', 'Sticky notes'], ['world', 'World clocks'], ['cal', 'Calendar'], ['count', 'Countdowns'], ['tools', 'Toolbox']],
  };

  // A "Your desk" section in the Customize panel.
  const pb = document.querySelector('#panel .panel-body');
  if (pb) {
    const sec = el('section', {}, [el('h3', { text: 'Your desk' })]);
    const sw = (label, on, fn) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = on; cb.addEventListener('change', () => fn(cb.checked));
      return el('label', { class: 'toggle' }, [el('span', { text: label }), el('span', { class: 'switch' }, [cb, el('span')])]);
    };
    sec.append(sw('Show your desk', S.show, (v) => window.LanternDesk.setShow(v)));
    for (const [id, name] of window.LanternDesk.widgets) sec.append(sw(name, !!S.widgets[id], (v) => window.LanternDesk.setWidget(id, v)));
    const more = pb.querySelector('.more-settings');
    pb.insertBefore(sec, more || null);
  }

  applyWidgets(); renderTasks(); renderNotes(); renderClocks(); renderCal(); renderCountdowns(); tPaint();
  setInterval(renderClocks, 30000);
})();
