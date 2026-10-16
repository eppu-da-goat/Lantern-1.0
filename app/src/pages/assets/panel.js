'use strict';
// Lantern's side panel: an AI assistant that answers with Claude, ChatGPT, Gemini or Groq using
// the user's own API key, plus reading mode and sharing. Keys are handled in the main process
// and never reach this page; it only sees which services have a key and a masked preview.
(() => {
  const api = window.lantern;
  const $ = (id) => document.getElementById(id);
  const md = window.LanternMarkdown;

  let mode = 'ai';
  let ai = null;            // { active, providers: [...] }
  let tab = null;           // the active tab: { title, url, web }
  let messages = [];        // [{ role, content, provider, name, model, error, page }]
  let running = null;       // { id, index }
  let selection = '';
  let usePage = true;

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
  window.addEventListener('lantern-copy', (e) => { api.panelCopy(e.detail); toast('Copied'); });
  const store = {
    get(k, d) { try { const v = localStorage.getItem('panel.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('panel.' + k, JSON.stringify(v)); } catch {} },
  };

  // ---------------- views ----------------
  function show(next, opts = {}) {
    mode = next;
    for (const b of document.querySelectorAll('.ptabs button')) {
      const on = b.dataset.mode === (next === 'keys' ? 'ai' : next);
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('on', on);
    }
    $('v-ai').hidden = next !== 'ai';
    $('v-keys').hidden = next !== 'keys';
    $('v-reader').hidden = next !== 'reader';
    $('v-share').hidden = next !== 'share';
    if (next === 'reader') loadReader();
    if (next === 'share') loadShare();
    if (next === 'keys') renderKeys(opts.provider);
    if (next === 'ai') setTimeout(() => $('input').focus(), 30);
  }
  document.querySelectorAll('.ptabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.mode)));
  $('close').addEventListener('click', () => api.panelClose());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !running && mode !== 'keys') api.panelClose(); });

  // ---------------- AI: services and models ----------------
  async function refreshAi() {
    ai = await api.aiState();
    renderProviders();
    renderWelcome();
    if (mode === 'keys') renderKeys();
  }
  function activeProvider() { return ai && ai.providers.find((p) => p.id === ai.active); }

  function renderProviders() {
    const box = $('providers');
    box.textContent = '';
    for (const p of ai.providers) {
      const b = el('button', 'prov' + (p.hasKey ? '' : ' nokey'));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(ai.active === p.id));
      b.dataset.p = p.id;
      b.append(el('span', 'dot ' + p.id), el('span', '', p.short));
      if (!p.hasKey) { const plus = el('span', 'plus', '+'); b.append(plus); }
      b.title = p.hasKey ? `Answer with ${p.name}` : `Add a ${p.short} API key`;
      b.addEventListener('click', async () => {
        if (!p.hasKey) { show('keys', { provider: p.id }); return; }
        ai = await api.aiSetActive(p.id);
        renderProviders();
        renderWelcome();
      });
      box.append(b);
    }
    const sel = $('model');
    const cur = activeProvider();
    sel.textContent = '';
    sel.hidden = !cur;
    if (cur) {
      const list = cur.modelList.length ? cur.modelList : [{ id: cur.model, label: cur.model }];
      if (!list.some((m) => m.id === cur.model)) list.unshift({ id: cur.model, label: cur.model });
      for (const m of list) {
        const o = el('option', '', m.label && m.label !== m.id ? `${m.label}` : m.id);
        o.value = m.id;
        o.title = m.id;
        sel.append(o);
      }
      sel.value = cur.model;
    }
  }
  $('model').addEventListener('change', async () => {
    const cur = activeProvider();
    if (!cur) return;
    ai = await api.aiSetModel(cur.id, $('model').value);
    toast(`Using ${$('model').value}`);
  });

  function renderWelcome() {
    const cur = activeProvider();
    $('welcome').hidden = messages.length > 0;
    $('quick').hidden = !cur || !(tab && tab.web);
    $('welcome-title').textContent = cur ? `Ask ${cur.short} anything` : 'Add an AI service';
    $('welcome-text').textContent = cur
      ? (tab && tab.web ? 'Ask about this page, or anything else. Your question and the page text go only to ' + cur.name + '.' : 'Your messages go only to ' + cur.name + ', with your own API key.')
      : 'Paste an API key from Claude, ChatGPT, Gemini or Groq. Lantern keeps it encrypted on this device.';
    let cta = $('welcome-cta');
    if (!cur) {
      if (!cta) {
        cta = el('button', 'btn primary', 'Add an API key');
        cta.id = 'welcome-cta';
        cta.type = 'button';
        cta.addEventListener('click', () => show('keys'));
        $('welcome').append(cta);
      }
    } else if (cta) cta.remove();
    $('input').placeholder = cur ? `Ask ${cur.short}…` : 'Add an API key to start';
  }

  // ---------------- AI: page context ----------------
  function renderPageChip() {
    const chip = $('use-page');
    chip.hidden = !(tab && tab.web);
    chip.setAttribute('aria-pressed', String(usePage));
    $('page-name').textContent = tab && tab.web ? (tab.title || tab.url).slice(0, 60) : '';
    chip.title = usePage ? 'This page\'s text is sent with your question. Click to stop sending it.' : 'Click to send this page\'s text with your question.';
    const sc = $('sel-chip');
    sc.hidden = !selection;
    sc.textContent = selection ? `“${selection.slice(0, 48)}${selection.length > 48 ? '…' : ''}”` : '';
    sc.title = 'Selected text is included. Click to remove it.';
    renderWelcome();
  }
  $('use-page').addEventListener('click', () => { usePage = !usePage; store.set('usePage', usePage); renderPageChip(); });
  $('sel-chip').addEventListener('click', () => { selection = ''; renderPageChip(); });

  // ---------------- AI: conversation ----------------
  function renderMessage(i) {
    const m = messages[i];
    const list = $('messages');
    let li = list.children[i];
    if (!li) { li = el('li'); list.append(li); }
    li.className = 'msg ' + m.role + (m.error ? ' error' : '') + (running && running.index === i ? ' streaming' : '');
    li.textContent = '';
    if (m.role === 'user') {
      if (m.page) li.append(el('span', 'ctx-note', `About: ${m.page}`));
      const b = el('div', 'bubble');
      b.append(md.render(m.content));
      li.append(b);
      return;
    }
    const head = el('div', 'who');
    head.append(el('span', 'dot ' + (m.provider || '')), el('span', '', m.name || 'AI'));
    if (m.model) head.append(el('span', 'model', m.model));
    li.append(head);
    const body = el('div', 'answer');
    if (m.error) body.append(el('p', '', m.error));
    else if (!m.content && running && running.index === i) body.append(el('span', 'typing', ''));
    else body.append(md.render(m.content));
    li.append(body);
    if (!(running && running.index === i)) {
      const tools = el('div', 'msg-tools');
      if (m.content) {
        const copy = el('button', 'mini', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', () => { api.panelCopy(m.content); toast('Copied'); });
        tools.append(copy);
      }
      if (i === messages.length - 1) {
        const retry = el('button', 'mini', m.error ? 'Try again' : 'Regenerate');
        retry.type = 'button';
        retry.addEventListener('click', () => { messages.splice(i, 1); list.children[i].remove(); run(); });
        tools.append(retry);
      }
      if (m.error && /key/i.test(m.error)) {
        const keys = el('button', 'mini', 'API keys');
        keys.type = 'button';
        keys.addEventListener('click', () => show('keys', { provider: m.provider }));
        tools.append(keys);
      }
      if (m.finish === 'length') tools.append(el('span', 'note', 'Answer was cut short'));
      if (m.finish === 'stopped') tools.append(el('span', 'note', 'Stopped'));
      li.append(tools);
    }
  }
  function scrollDown(force) {
    const c = $('chat');
    if (force || c.scrollHeight - c.scrollTop - c.clientHeight < 140) c.scrollTop = c.scrollHeight;
  }
  let raf = 0;
  function scheduleRender(i) {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderMessage(i); scrollDown(); });
  }

  async function ask(text, { page } = {}) {
    const q = String(text || '').trim();
    if (!q || running) return;
    if (!activeProvider()) { show('keys'); return; }
    const withPage = page !== undefined ? page : usePage && tab && tab.web;
    messages.push({ role: 'user', content: q, page: withPage && tab ? (tab.title || tab.url) : '', selection });
    renderMessage(messages.length - 1);
    $('welcome').hidden = true;
    scrollDown(true);
    await run({ includePage: !!withPage });
  }

  async function run({ includePage } = {}) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (includePage === undefined) includePage = !!(lastUser && lastUser.page);
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    const cur = activeProvider();
    messages.push({ role: 'assistant', content: '', provider: cur.id, name: cur.short, model: cur.model });
    const index = messages.length - 1;
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    running = { id, index };
    setBusy(true);
    renderMessage(index);
    scrollDown(true);
    try {
      await api.aiSend({ id, messages: history, includePage, selection: lastUser && lastUser.selection ? lastUser.selection : '' });
    } catch (err) {
      finish(id, { error: cleanErr(err) });
    }
    selection = '';
    renderPageChip();
  }
  function cleanErr(err) { return String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  function finish(id, { error, finish: f } = {}) {
    if (!running || running.id !== id) return;
    const i = running.index;
    running = null;
    if (error) messages[i].error = error;
    if (f) messages[i].finish = f;
    renderMessage(i);
    if (i > 0) renderMessage(i - 1);
    setBusy(false);
    scrollDown();
  }
  api.onAiEvent((m) => {
    if (!running || m.id !== running.id) return;
    const msg = messages[running.index];
    if (m.type === 'start') { msg.provider = m.provider; msg.name = m.name; msg.model = m.model; scheduleRender(running.index); }
    else if (m.type === 'delta') { msg.content += m.text; scheduleRender(running.index); }
    else if (m.type === 'done') finish(m.id, { finish: m.finish });
    else if (m.type === 'error') finish(m.id, { error: m.message });
  });

  function setBusy(on) {
    $('send').hidden = on;
    $('stop').hidden = !on;
    $('input').disabled = false;
    document.body.classList.toggle('busy', on);
  }
  $('stop').addEventListener('click', () => { if (running) api.aiStop(running.id); });

  const input = $('input');
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
  });
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (running) return;
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    grow();
    ask(text);
  });
  $('quick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) ask(b.dataset.q, { page: true });
  });
  $('new-chat').addEventListener('click', () => {
    if (running) api.aiStop(running.id);
    running = null;
    messages = [];
    $('messages').textContent = '';
    setBusy(false);
    renderWelcome();
    input.focus();
  });
  $('open-keys').addEventListener('click', () => show('keys'));

  // ---------------- API keys ----------------
  let keyTarget = '';
  function renderKeys(focusProvider) {
    if (!ai) return;
    const sel = $('key-provider');
    if (sel.options.length <= 1) for (const p of ai.providers) { const o = el('option', '', p.name); o.value = p.id; sel.append(o); }
    if (focusProvider) { sel.value = focusProvider; keyTarget = focusProvider; setTimeout(() => $('key-input').focus(), 30); }
    const list = $('key-list');
    list.textContent = '';
    for (const p of ai.providers) {
      const li = el('li', 'card key-row' + (ai.active === p.id ? ' active' : ''));
      const top = el('div', 'kr-top');
      top.append(el('span', 'dot ' + p.id));
      const name = el('div', 'kr-name');
      name.append(el('b', '', p.name), el('span', 'muted small', p.hasKey ? `Key ${p.mask}` : 'No key yet'));
      top.append(name);
      if (p.hasKey) {
        const use = el('button', 'btn sm' + (ai.active === p.id ? ' primary' : ''), ai.active === p.id ? 'In use' : 'Use');
        use.type = 'button';
        use.disabled = ai.active === p.id;
        use.addEventListener('click', async () => { ai = await api.aiSetActive(p.id); renderProviders(); renderKeys(); renderWelcome(); toast(`${p.short} will answer`); });
        top.append(use);
      }
      li.append(top);
      const bottom = el('div', 'kr-bottom');
      if (p.hasKey) {
        const msel = el('select');
        msel.setAttribute('aria-label', `${p.short} model`);
        const models = p.modelList.length ? p.modelList : [{ id: p.model }];
        if (!models.some((m) => m.id === p.model)) models.unshift({ id: p.model });
        for (const m of models) { const o = el('option', '', m.label && m.label !== m.id ? m.label : m.id); o.value = m.id; msel.append(o); }
        msel.value = p.model;
        msel.addEventListener('change', async () => { ai = await api.aiSetModel(p.id, msel.value); renderProviders(); toast('Model saved'); });
        const refresh = el('button', 'link', 'Refresh models');
        refresh.type = 'button';
        refresh.addEventListener('click', async () => {
          refresh.textContent = 'Checking…';
          try { ai = await api.aiRefreshModels(p.id); renderKeys(); renderProviders(); toast('Model list updated'); } catch (err) { toast(cleanErr(err)); refresh.textContent = 'Refresh models'; }
        });
        const replace = el('button', 'link', 'Replace key');
        replace.type = 'button';
        replace.addEventListener('click', () => { $('key-provider').value = p.id; keyTarget = p.id; $('key-input').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
        const remove = el('button', 'link danger', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (remove.dataset.confirm !== '1') { remove.dataset.confirm = '1'; remove.textContent = 'Click again to remove'; setTimeout(() => { remove.dataset.confirm = ''; remove.textContent = 'Remove'; }, 3000); return; }
          ai = await api.aiRemoveKey(p.id); renderProviders(); renderKeys(); renderWelcome(); toast(`${p.short} key removed`);
        });
        bottom.append(msel, refresh, replace, remove);
      } else {
        const add = el('button', 'link', `Add a ${p.short} key`);
        add.type = 'button';
        add.addEventListener('click', () => { $('key-provider').value = p.id; keyTarget = p.id; $('key-input').focus(); });
        bottom.append(add);
      }
      const get = el('button', 'link', 'Get a key ↗');
      get.type = 'button';
      get.addEventListener('click', () => api.openTab(p.keyUrl));
      bottom.append(get);
      li.append(bottom);
      list.append(li);
    }
    $('key-safety').textContent = ai.encrypted
      ? 'Keys are encrypted with your system keychain and stay on this device. Each key is only ever sent to the service it belongs to.'
      : 'Keys stay on this device and are only sent to the service they belong to. (This system has no keychain, so they are stored unencrypted.)';
  }

  let detectTimer;
  $('key-input').addEventListener('input', () => {
    clearTimeout(detectTimer);
    $('key-msg').hidden = true;
    $('key-switch').hidden = true;
    detectTimer = setTimeout(async () => {
      const key = $('key-input').value.trim();
      if (!key) { $('key-detect').textContent = ''; return; }
      const d = await api.aiDetect(key);
      if (d.provider) {
        $('key-provider').value = d.provider;
        $('key-detect').textContent = `Looks like a ${d.name} key.`;
      } else if (d.other) {
        $('key-detect').textContent = `That looks like an ${d.other} key, which Lantern doesn't support.`;
      } else {
        $('key-detect').textContent = keyTarget ? '' : 'Choose which service this key is for.';
        if (keyTarget) $('key-provider').value = keyTarget;
      }
    }, 150);
  });
  $('key-reveal').addEventListener('click', () => {
    const i = $('key-input');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('key-reveal').title = i.type === 'password' ? 'Show key' : 'Hide key';
  });
  async function saveKey(provider) {
    const key = $('key-input').value;
    const msg = $('key-msg');
    $('key-switch').hidden = true;
    if (!provider) { msg.hidden = false; msg.className = 'msg bad'; msg.textContent = 'Choose which service this key is for.'; return; }
    $('key-save').disabled = true;
    $('key-save').textContent = 'Checking…';
    try {
      const r = await api.aiSaveKey(provider, key);
      msg.hidden = false;
      msg.className = 'msg ' + (r.ok ? 'good' : 'bad');
      msg.textContent = r.message;
      if (r.ok) {
        $('key-input').value = '';
        $('key-detect').textContent = '';
        keyTarget = '';
        ai = r.state;
        renderProviders();
        renderKeys();
        renderWelcome();
      } else if (r.suggest) {
        const name = ai.providers.find((p) => p.id === r.suggest).short;
        const sw = $('key-switch');
        sw.hidden = false;
        sw.textContent = `Save as ${name} instead`;
        sw.onclick = () => { $('key-provider').value = r.suggest; saveKey(r.suggest); };
      }
    } catch (err) {
      msg.hidden = false; msg.className = 'msg bad'; msg.textContent = cleanErr(err);
    } finally {
      $('key-save').disabled = false;
      $('key-save').textContent = 'Check and save';
    }
  }
  $('key-form').addEventListener('submit', (e) => { e.preventDefault(); saveKey($('key-provider').value); });
  $('key-provider').addEventListener('change', () => { keyTarget = $('key-provider').value; });
  $('keys-back').addEventListener('click', () => show('ai'));

  // ---------------- reading mode ----------------
  let readerFor = '';
  let readerSize = store.get('readerSize', 17);
  let readerSerif = store.get('readerSerif', true);
  function applyReaderStyle() {
    $('article').style.fontSize = readerSize + 'px';
    $('article').classList.toggle('serif', !!readerSerif);
  }
  async function loadReader(force) {
    if (!tab || !tab.web) { $('article').textContent = ''; $('r-empty').hidden = false; $('r-ask').hidden = true; $('r-meta').textContent = ''; readerFor = ''; return; }
    if (!force && readerFor === tab.url) return;
    readerFor = tab.url;
    $('r-empty').hidden = true;
    $('r-loading').hidden = false;
    $('article').textContent = '';
    let page = null;
    try { page = await api.panelRead(); } catch {}
    $('r-loading').hidden = true;
    if (readerFor !== (tab && tab.url)) return;
    if (!page || !page.blocks || !page.blocks.length) { $('r-empty').hidden = false; $('r-ask').hidden = true; return; }
    const art = $('article');
    art.append(el('h1', '', page.title));
    if (page.byline || page.site) art.append(el('p', 'byline', [page.byline, page.site].filter(Boolean).join(' · ')));
    for (const b of page.blocks) {
      if (page.byline && (b.text === page.byline || b.text === `By ${page.byline}`)) continue;
      if (/^h\d$/.test(b.t)) { if (b.text !== page.title) art.append(el(b.t === 'h1' ? 'h2' : b.t, '', b.text)); }
      else if (b.t === 'li') art.append(el('p', 'li', b.text));
      else if (b.t === 'pre') art.append(el('pre', '', b.text));
      else if (b.t === 'blockquote') art.append(el('blockquote', '', b.text));
      else if (b.t === 'figcaption') art.append(el('p', 'caption', b.text));
      else art.append(el('p', '', b.text));
    }
    $('r-meta').textContent = `${page.minutes} min read · ${page.words.toLocaleString()} words`;
    $('r-ask').hidden = false;
    applyReaderStyle();
  }
  $('r-smaller').addEventListener('click', () => { readerSize = Math.max(13, readerSize - 1); store.set('readerSize', readerSize); applyReaderStyle(); });
  $('r-bigger').addEventListener('click', () => { readerSize = Math.min(26, readerSize + 1); store.set('readerSize', readerSize); applyReaderStyle(); });
  $('r-serif').addEventListener('click', () => { readerSerif = !readerSerif; store.set('readerSerif', readerSerif); applyReaderStyle(); });
  $('r-ask').addEventListener('click', () => { show('ai'); ask('Summarize this article in a few key points, then tell me what it leaves out.', { page: true }); });

  // ---------------- share ----------------
  async function loadShare() {
    let s = null;
    try { s = await api.panelShare(); } catch {}
    $('s-body').hidden = !s;
    $('s-empty').hidden = !!s;
    if (!s) return;
    $('s-title').textContent = s.title;
    $('s-url').value = s.url;
    $('s-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.qr);
  }
  $('s-copy').addEventListener('click', () => { api.panelCopy($('s-url').value); toast('Link copied'); });
  $('s-save').addEventListener('click', async () => { if (await api.panelSaveQr()) toast('QR code saved'); });

  // ---------------- messages from the browser ----------------
  let aiReady = null;
  api.onPanel(async (m) => {
    if (m.type === 'mode' && aiReady) await aiReady;
    if (m.type === 'tab') {
      const changed = !tab || !m.tab || tab.url !== m.tab.url;
      tab = m.tab;
      renderPageChip();
      if (changed && mode === 'reader') loadReader(true);
      if (changed && mode === 'share') loadShare();
    } else if (m.type === 'mode') {
      if (m.view === 'keys') { refreshAi().then(() => show('keys', { provider: m.provider })); return; }
      show(m.mode || 'ai');
      if (m.mode === 'ai' && m.selection) { selection = String(m.selection); renderPageChip(); }
      if (m.mode === 'ai' && m.prompt) {
        if (m.send && activeProvider()) ask(m.prompt, { page: !!(tab && tab.web) });
        else { input.value = m.prompt; grow(); input.focus(); }
      }
    } else if (m.type === 'ai-state') refreshAi();
  });

  usePage = store.get('usePage', true);
  applyReaderStyle();
  api.info().then((i) => { if (window.LanternTheme) window.LanternTheme.apply(i.settings.themeColor, i.palette); }).catch(() => {});
  aiReady = refreshAi().then(() => { renderPageChip(); show(mode); }).catch(() => {});
  window.addEventListener('focus', () => refreshAi());
})();
