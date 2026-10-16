'use strict';
(() => {
  const api = window.lantern;
  const $ = (id) => document.getElementById(id);
  let info = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.hidden = false;
    t.textContent = msg;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  async function set(key, value, msg) {
    try {
      info.settings = await api.setSetting(key, value);
      if (msg) toast(msg);
    } catch {
      toast("That setting couldn't be saved");
      render();
    }
  }

  // ---------- generic controls ----------
  function bindControls() {
    document.querySelectorAll('[data-setting]').forEach((ctrl) => {
      const key = ctrl.dataset.setting;
      if (ctrl.type === 'checkbox') {
        ctrl.addEventListener('change', () => set(key, ctrl.checked, ctrl.checked ? 'Turned on' : 'Turned off'));
      } else if (ctrl.tagName === 'SELECT') {
        ctrl.addEventListener('change', () => set(key, ctrl.dataset.type === 'number' ? Number(ctrl.value) : ctrl.value, 'Saved'));
      }
    });
    document.querySelectorAll('#theme button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#theme button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      set('theme', b.dataset.v);
    }));
    document.querySelectorAll('input[name="startup"]').forEach((r) => r.addEventListener('change', () => {
      $('url-row').hidden = r.value !== 'url';
      if (r.value !== 'url' || info.settings.startupUrl) set('startup', r.value, 'Saved');
      if (r.value === 'url') $('startup-url').focus();
    }));
    $('save-url').addEventListener('click', async () => {
      let v = $('startup-url').value.trim();
      if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      try { new URL(v); } catch { $('url-msg').textContent = 'Enter a full web address, like https://example.com'; return; }
      $('url-msg').textContent = '';
      $('startup-url').value = v;
      await set('startupUrl', v);
      await set('startup', 'url', 'Saved');
    });
  }

  function render() {
    const s = info.settings;
    document.querySelectorAll('[data-setting]').forEach((ctrl) => {
      const v = s[ctrl.dataset.setting];
      if (ctrl.type === 'checkbox') ctrl.checked = !!v;
      else if (ctrl.tagName === 'SELECT') ctrl.value = String(v);
    });
    document.querySelectorAll('#theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.theme)));
    document.querySelectorAll('input[name="startup"]').forEach((r) => { r.checked = r.value === s.startup; });
    $('url-row').hidden = s.startup !== 'url';
    $('startup-url').value = s.startupUrl || '';
    $('dl-path').textContent = s.downloadsDir || info.downloadsDefault;
    renderProfile();
    renderPerms();
    renderThemes();
    renderCustomColour();
    renderMail();
    renderAi();
  }

  // ---------- your own colour (palette worked out by the Rust core) ----------
  async function renderCustomColour(palette) {
    const s = info.settings;
    const hex = s.customAccent || '#3b82f6';
    $('custom-accent').value = hex;
    const p = palette || info.palette || await api.themePalette(hex).catch(() => null);
    if (!p) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const v = p[dark ? 'dark' : 'light'];
    const [a, b, c] = $('custom-preview').children;
    a.style.background = v.accent; b.style.background = v.accent2; c.style.background = v.glowA;
    $('custom-note').textContent = s.themeColor === 'custom'
      ? `In use. Adjusted to ${p.light.accent} in light mode and ${p.dark.accent} in dark mode so text stays readable.`
      : 'Pick any colour. Lantern adjusts it for light and dark mode so text stays readable.';
  }
  $('custom-accent').addEventListener('change', async () => {
    const hex = $('custom-accent').value;
    try {
      info.settings = await api.setSetting('customAccent', hex);
      const p = await api.themePalette(hex);
      info.palette = p;
      window.LanternTheme.apply('custom', p);
      renderThemes();
      renderCustomColour(p);
      toast('Your colour is on');
    } catch { toast("That colour couldn't be used"); }
  });

  // ---------- mail link ----------
  function renderMail() {
    const sel = $('mail-service');
    if (!sel.options.length) {
      for (const m of info.mailServices) { const o = el('option', '', m.name); o.value = m.id; sel.appendChild(o); }
    }
    sel.value = info.settings.mailService || 'gmail';
    $('mail-row').hidden = sel.value !== 'custom';
    $('mail-url').value = info.settings.mailUrl || '';
  }
  $('mail-service').addEventListener('change', async () => {
    const v = $('mail-service').value;
    $('mail-row').hidden = v !== 'custom';
    if (v === 'custom') { if (info.settings.mailUrl) set('mailService', 'custom', 'Saved'); else $('mail-url').focus(); return; }
    await set('mailService', v, v === 'off' ? 'Mail link hidden' : 'Saved');
  });
  $('mail-save').addEventListener('click', async () => {
    let v = $('mail-url').value.trim();
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      await api.mailPreview('custom', v);
      $('mail-msg').textContent = '';
      $('mail-url').value = v;
      await set('mailUrl', v);
      await set('mailService', 'custom', 'Saved');
    } catch (err) {
      $('mail-msg').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
  });

  // ---------- AI ----------
  async function renderAi() {
    const st = await api.aiState().catch(() => null);
    const list = $('ai-list');
    list.replaceChildren();
    if (!st) return;
    const withKeys = st.providers.filter((p) => p.hasKey);
    $('ai-status').textContent = withKeys.length
      ? `${withKeys.length} service${withKeys.length === 1 ? '' : 's'} set up. Switch between them with the arrow on the AI button, or in the side panel.`
      : 'Add a key from Claude, ChatGPT, Gemini or Groq to use the AI assistant. Paste a key, say which service it\'s for, and Lantern sends your questions straight to that service.';
    for (const p of withKeys) {
      const li = el('li');
      li.append(el('span', 'dot ' + p.id), el('span', '', p.name), el('span', 'k', `${p.mask} · ${p.model}`));
      if (st.active === p.id) li.append(el('span', 'use', 'In use'));
      list.appendChild(li);
    }
  }
  $('ai-keys').addEventListener('click', () => api.panelOpen('ai', { view: 'keys' }));
  window.addEventListener('focus', () => { if (info) renderAi(); });
  $('kbd-bar').textContent = navigator.platform.startsWith('Mac') ? '⇧⌘B' : 'Ctrl+Shift+B';
  function renderThemes() {
    const box = $('theme-colors');
    if (!window.LanternTheme) return;
    if (!box.children.length) {
      Object.entries(window.LanternTheme.PRESETS).forEach(([key, p]) => {
        const b = el('button');
        b.type = 'button';
        b.dataset.key = key;
        b.title = p.name;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', p.name);
        b.style.background = `linear-gradient(135deg, ${p.light[0]} 50%, ${p.light[1]} 50%)`;
        b.addEventListener('click', async () => { await set('themeColor', key, `${p.name} theme`); window.LanternTheme.apply(key); renderThemes(); });
        box.appendChild(b);
      });
    }
    [...box.children].forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === info.settings.themeColor)));
  }

  // ---------- profiles ----------
  function renderProfile() {
    const p = info.profile;
    document.documentElement.style.setProperty('--profile', p.color);
    $('me-avatar').textContent = p.name.trim().charAt(0).toUpperCase() || 'P';
    if (document.activeElement !== $('me-name')) $('me-name').value = p.name;
    const sw = $('me-colors');
    sw.replaceChildren();
    info.colors.forEach((c) => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.style.background = c;
      b.style.color = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Color ${c}`);
      b.setAttribute('aria-checked', String(c === p.color));
      b.addEventListener('click', async () => {
        info.profile = await api.updateProfile({ color: c });
        const av = $('me-avatar');
        av.classList.add('bump');
        setTimeout(() => av.classList.remove('bump'), 300);
        renderProfile();
      });
      sw.appendChild(b);
    });
    const list = $('profiles');
    list.replaceChildren();
    const others = info.profiles.filter((x) => x.id !== p.id);
    if (!others.length) list.appendChild(el('li', 'sub', 'No other profiles yet. Add one to keep work and personal browsing apart.'));
    others.forEach((o, i) => {
      const li = el('li');
      li.style.animationDelay = `${i * 40}ms`;
      const dot = el('span', 'dot', o.name.charAt(0).toUpperCase());
      dot.style.background = o.color;
      const open = el('button', 'link', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => api.openProfile(o.id));
      const del = el('button', 'link danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', () => {
        const box = el('span', 'confirm', `Delete ${o.name} and all its data?`);
        const yes = el('button', 'link danger', 'Delete');
        const no = el('button', 'link', 'Keep');
        yes.type = no.type = 'button';
        yes.addEventListener('click', async () => {
          info.profiles = await api.deleteProfile(o.id);
          toast(`${o.name} deleted`);
          renderProfile();
        });
        no.addEventListener('click', () => renderProfile());
        box.append(yes, no);
        del.replaceWith(box);
        open.remove();
      });
      li.append(dot, el('span', 'grow', o.name), open, del);
      list.appendChild(li);
    });
  }
  let nameTimer;
  $('me-name').addEventListener('input', () => {
    clearTimeout(nameTimer);
    const v = $('me-name').value.trim();
    $('me-avatar').textContent = v.charAt(0).toUpperCase() || 'P';
    if (!v) return;
    nameTimer = setTimeout(async () => { info.profile = await api.updateProfile({ name: v }); toast('Name saved'); }, 600);
  });
  $('add-profile').addEventListener('click', async () => {
    info.profiles = await api.createProfile({});
    renderProfile();
    toast('New profile opened in its own window');
  });

  // ---------- site permissions ----------
  function renderPerms() {
    const perms = info.settings.sitePermissions || {};
    const origins = Object.keys(perms);
    $('perm-summary').textContent = origins.length ? `${origins.length} site${origins.length === 1 ? '' : 's'}` : 'None yet';
    $('reset-perms').hidden = !origins.length;
    const ul = $('perm-list');
    ul.replaceChildren();
    origins.forEach((o) => {
      const li = el('li');
      const what = Object.entries(perms[o]).map(([k, v]) => `${k} ${v ? 'allowed' : 'blocked'}`).join(', ');
      const host = (() => { try { return new URL(o).host; } catch { return o; } })();
      const reset = el('button', 'link', 'Reset');
      reset.type = 'button';
      reset.addEventListener('click', async () => { info.settings.sitePermissions = await api.resetSitePermissions(o); renderPerms(); });
      const text = el('span', 'grow');
      text.append(el('b', '', host), document.createTextNode(' · ' + what));
      li.append(text, reset);
      ul.appendChild(li);
    });
  }
  $('reset-perms').addEventListener('click', async () => {
    info.settings.sitePermissions = await api.resetSitePermissions();
    renderPerms();
    toast('Site permissions reset');
  });

  // ---------- clear data ----------
  $('clear-now').addEventListener('click', async () => {
    const btn = $('clear-now');
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    await api.clearData({ cookies: $('c-cookies').checked, cache: $('c-cache').checked, history: $('c-history').checked });
    btn.disabled = false;
    btn.textContent = 'Clear data';
    $('cleared').hidden = false;
    setTimeout(() => { $('cleared').hidden = true; }, 2500);
  });

  // ---------- extensions ----------
  async function renderExtensions(list) {
    if (!list) list = await api.extensions().catch(() => []);
    const ul = $('ext-list');
    ul.replaceChildren();
    $('ext-empty').hidden = list.length > 0 || !info.extensionsAvailable;
    $('ext-off').hidden = !!info.extensionsAvailable;
    $('store').disabled = $('unpacked').disabled = !info.extensionsAvailable;
    list.forEach((x, i) => {
      const li = el('li', 'ext');
      li.style.setProperty('--i', i);
      if (x.icon) { const img = el('img'); img.src = x.icon; img.alt = ''; li.appendChild(img); } else li.appendChild(el('span', 'ph'));
      li.append(el('h4', '', x.name), el('p', '', x.description || ' '));
      const meta = el('div', 'meta');
      meta.appendChild(el('span', '', `Version ${x.version}${x.unpacked ? ' · unpacked' : ''}`));
      const rm = el('button', 'link danger', 'Remove');
      rm.type = 'button';
      rm.addEventListener('click', async () => {
        rm.disabled = true;
        renderExtensions(await api.removeExtension(x.id));
        toast(`${x.name} removed`);
      });
      meta.appendChild(rm);
      li.appendChild(meta);
      ul.appendChild(li);
    });
  }
  $('store').addEventListener('click', () => api.openTab('https://chromewebstore.google.com/'));
  $('unpacked').addEventListener('click', async () => renderExtensions(await api.loadUnpacked()));

  // ---------- downloads ----------
  $('dl-change').addEventListener('click', async () => {
    const dir = await api.pickDownloadsDir();
    info.settings.downloadsDir = dir;
    $('dl-path').textContent = dir || info.downloadsDefault;
  });

  // ---------- navigation highlight ----------
  const links = [...document.querySelectorAll('.side a')];
  const sections = [...document.querySelectorAll('.section')];
  function markCurrent(id) { links.forEach((a) => a.classList.toggle('current', a.dataset.s === id)); }
  let navLock = 0;
  function onScroll() {
    if (Date.now() < navLock) return;
    const visible = sections.filter((sec) => !sec.classList.contains('dim'));
    let current = visible[0];
    for (const sec of visible) if (sec.getBoundingClientRect().top <= 140) current = sec;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = visible[visible.length - 1];
    if (current) markCurrent(current.id);
  }
  addEventListener('scroll', onScroll, { passive: true });
  links.forEach((a) => a.addEventListener('click', () => { navLock = Date.now() + 700; markCurrent(a.dataset.s); }));

  // ---------- search settings ----------
  $('filter').addEventListener('input', () => {
    const q = $('filter').value.trim().toLowerCase();
    let any = false;
    sections.forEach((sec) => {
      const rows = [...sec.querySelectorAll('.row, .radio, .checks label, .explain, .me')];
      let secHit = !q || sec.querySelector('h2').textContent.toLowerCase().includes(q);
      rows.forEach((r) => {
        const hit = !q || secHit || r.textContent.toLowerCase().includes(q);
        r.classList.toggle('dim', !hit);
        if (hit && q) secHit = true;
      });
      if (q && !secHit) sec.classList.add('dim'); else sec.classList.remove('dim');
      if (!sec.classList.contains('dim')) any = true;
    });
    $('no-match').hidden = any;
  });

  // ---------- safety check ----------
  const ICON = {
    ok: '<svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7"/></svg>',
    warn: '<svg viewBox="0 0 20 20"><path d="M10 5v6M10 14.5v.2"/></svg>',
    info: '<svg viewBox="0 0 20 20"><path d="M10 9v5M10 6v.2"/></svg>',
  };
  function ago(ms) {
    if (!ms) return 'never';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 2) return 'just now';
    if (m < 60) return `${m} minutes ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} days ago`;
  }
  function scItem(state, title, text, action) {
    const li = el('li');
    const icon = el('span', `sc-icon ${state}`);
    icon.innerHTML = ICON[state];
    const t = el('span', 'sc-text');
    t.append(el('b', '', title), el('span', '', text));
    li.append(icon, t);
    if (action) {
      const b = el('button', 'link', action.label);
      b.type = 'button';
      b.addEventListener('click', action.run);
      li.appendChild(b);
    } else li.appendChild(el('span'));
    return li;
  }
  const fix = (key, value) => async () => { await set(key, value, 'Turned on'); render(); runSafetyCheck(); };
  const jump = (id) => () => document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
  async function runSafetyCheck(refresh) {
    const list = $('sc-list');
    $('sc-run').disabled = true;
    $('sc-when').innerHTML = '<span class="sc-checking"></span>Checking…';
    let st;
    try { st = await api.safetyStatus(!!refresh); } catch { $('sc-run').disabled = false; return; }
    const s = st.settings;
    const items = [];
    const lists = st.lists || { phishing: 0, malware: 0, updatedAt: 0 };
    const listCount = lists.phishing + lists.malware;
    if (!s.safeBrowsing) items.push(['warn', 'Dangerous site protection is off', 'Scam and malware sites will load without a warning.', { label: 'Turn on', run: fix('safeBrowsing', true) }]);
    else if (!listCount) items.push(['warn', 'Threat lists haven\'t downloaded yet', 'Lantern needs an internet connection to fetch them. It tries again every hour.', { label: 'Try now', run: () => runSafetyCheck(true) }]);
    else items.push(['ok', 'Dangerous site protection is on', `${listCount.toLocaleString()} known scam and malware sites · updated ${ago(lists.updatedAt)}`]);
    items.push(s.blockTrackers
      ? ['ok', 'Trackers are blocked', `${st.blockedTotal.toLocaleString()} blocked this session`]
      : ['warn', 'Tracker blocking is off', 'Ad networks can follow you across sites.', { label: 'Turn on', run: fix('blockTrackers', true) }]);
    items.push(s.httpsOnly
      ? ['ok', 'Secure connections are enforced', 'Sites are upgraded to HTTPS automatically.']
      : ['warn', 'Insecure connections are allowed', 'Pages can load over plain HTTP without a warning.', { label: 'Turn on', run: fix('httpsOnly', true) }]);
    items.push(s.downloadWarnings
      ? ['ok', 'Risky downloads are checked', 'You\'re asked before files that can run programs are saved.']
      : ['warn', 'Download warnings are off', 'Programs can download without a prompt.', { label: 'Turn on', run: fix('downloadWarnings', true) }]);
    items.push(st.extensions
      ? ['info', `${st.extensions} extension${st.extensions === 1 ? '' : 's'} installed`, 'Extensions can read the sites you visit. Remove any you don\'t use.', { label: 'Review', run: jump('extensions') }]
      : ['ok', 'No extensions installed', 'Nothing extra can read your browsing.']);
    if (st.remembered) items.push(['info', `${st.remembered} site${st.remembered === 1 ? '' : 's'} have saved permissions`, 'Camera, microphone or notification choices you made.', { label: 'Review', run: () => $('perm-list').scrollIntoView({ behavior: 'smooth', block: 'center' }) }]);
    list.replaceChildren();
    items.forEach((it, i) => { const li = scItem(...it); li.style.setProperty('--i', i); list.appendChild(li); });
    const warnings = items.filter((i) => i[0] === 'warn').length;
    $('sc-when').textContent = warnings ? `${warnings} thing${warnings === 1 ? '' : 's'} to review · checked just now` : 'Everything looks good · checked just now';
    $('sc-run').disabled = false;
  }
  $('sc-run').addEventListener('click', () => runSafetyCheck(true));

  // ---------- start ----------
  if (!api) return;
  bindControls();
  api.info().then((i) => {
    info = i;
    const engine = $('engine');
    Object.entries(info.engines).forEach(([k, name]) => { const o = el('option', '', name); o.value = k; engine.appendChild(o); });
    $('v-lantern').textContent = info.versions.lantern;
    $('v-engine').textContent = `Chromium ${info.versions.chromium} · Electron ${info.versions.electron}`;
    render();
    renderExtensions();
    runSafetyCheck(false);
    const target = location.hash.slice(1);
    if (target) { markCurrent(target); document.getElementById(target)?.scrollIntoView({ behavior: 'instant', block: 'start' }); }
    else markCurrent('you');
  });
})();
