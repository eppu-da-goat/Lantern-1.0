'use strict';
// End-to-end test of Lantern 1.7 in a real Electron window (development only).
// Run: LANTERN_TEST_SHOT=/tmp/shots LANTERN_AI_MOCK=1 LANTERN_NO_EXT=1 LANTERN_TEST_SCRIPT=test/e2e.js electron .
const fs = require('fs');
const path = require('path');
const http = require('http');

const ARTICLE = `<!doctype html><html><head><title>How lanterns work</title><meta name="author" content="Ada Example"></head><body>
<nav>Home · About · Shop</nav>
<article><h1>How lanterns work</h1><p class="byline">By Ada Example</p>
${Array.from({ length: 8 }, (_, i) => `<h2>Part ${i + 1}</h2><p>A lantern keeps a small flame safe from the wind while letting its light out through glass or paper. Section ${i + 1} explains why the chimney matters, how air flows in at the bottom and out at the top, and why the wick has to be trimmed so the flame stays steady and clean.</p><ul><li>Point one about airflow in part ${i + 1}.</li><li>Point two about the wick in part ${i + 1}.</li></ul>`).join('\n')}
</article><footer>© Example</footer></body></html>`;

module.exports = async function run(t) {
  const { windows, contexts, core, TEST_SHOT_DIR, openPrivateWindow, openLibrary, setBookmarksBar } = t;
  const log = (...a) => fs.appendFileSync(path.join(TEST_SHOT_DIR, 'console.txt'), `[e2e] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await wait(100); } return null; };

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/article')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(ARTICLE); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Page ${req.url}</title><h1>Page ${req.url}</h1><p>Hello.</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const w = [...windows][0];
  const ctx = w.ctx;
  ctx.settings.httpsOnly = false;
  w.win.setContentSize(1280, 820);
  w.win.showInactive();
  await wait(1500);

  const shoot = async (name, win = w) => {
    const [cw] = win.win.getContentSize();
    fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-ui.png`), (await win.win.webContents.capturePage({ x: 0, y: 0, width: cw, height: win.uiHeight() })).toPNG());
    const wc = win.activeWc();
    if (wc) fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-page.png`), (await wc.capturePage()).toPNG());
    if (win.panelOpen && win.panel) fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-panel.png`), (await win.panel.webContents.capturePage()).toPNG());
    const sv = win.suggestView;
    if (sv && win.win.contentView.children.includes(sv)) fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-popup.png`), (await sv.webContents.capturePage()).toPNG());
  };
  const load = async (url) => { const wc = w.activeWc(); await wc.loadURL(url).catch(() => {}); await wait(600); };
  const panelJs = (code) => w.panel.webContents.executeJavaScript(code);

  // ---- Rust core is loaded ----
  check('rust core loads', /^1\.7\./.test(core.version()), core.version());

  // ---- history ----
  await load(`${base}/article.html`);
  await load(`${base}/one.html`);
  await load(`${base}/article.html`);
  const hist = ctx.library.queryHistory({});
  check('history records visits', hist.length === 2 && hist[0].url.endsWith('/article.html') && hist[0].visits === 2, JSON.stringify(hist.map((h) => [h.title, h.visits])));
  check('history has page titles', hist[0].title === 'How lanterns work', hist[0].title);

  // ---- bookmarks + bar ----
  w.toggleBookmark();
  check('bookmark star adds', ctx.library.isBookmarked(`${base}/article.html`));
  setBookmarksBar(ctx, true);
  await wait(500);
  check('bookmarks bar grows the frame', w.uiHeight() === 116, String(w.uiHeight()));
  const tabBounds = w.activeTab().view.getBounds();
  check('page sits below the bar', tabBounds.y === 116, JSON.stringify(tabBounds));
  await shoot('bookmarked');

  // ---- zoom indicator ----
  w.zoom(1); w.zoom(1);
  await wait(300);
  const st = w.tabState(w.activeTab());
  check('zoom shows in state', st.zoom === 120, String(st.zoom));
  await shoot('zoomed');
  w.zoom(0);

  // ---- AI keys through the real panel UI ----
  w.openPanel('ai', { view: 'keys' });
  await until(() => w.panel && !w.panel.webContents.isLoading());
  await wait(800);
  const typeKey = async (key, provider) => {
    await panelJs(`(() => { const i = document.getElementById('key-input'); i.value = ${JSON.stringify(key)}; i.dispatchEvent(new Event('input')); })()`);
    await wait(400);
    if (provider) await panelJs(`document.getElementById('key-provider').value = ${JSON.stringify(provider)}`);
    await panelJs(`document.getElementById('key-form').requestSubmit()`);
    await wait(900);
    return panelJs(`({ msg: document.getElementById('key-msg').textContent, cls: document.getElementById('key-msg').className, detect: document.getElementById('key-detect').textContent, sw: document.getElementById('key-switch').hidden ? '' : document.getElementById('key-switch').textContent })`);
  };
  let r = await typeKey('gsk_' + 'A'.repeat(40));
  check('groq key auto-detected and saved', /good/.test(r.cls) && /Groq/.test(r.detect + r.msg) && ctx.ai.hasKey('groq'), JSON.stringify(r));
  r = await typeKey('gsk_' + 'B'.repeat(40), 'claude');
  await panelJs(`document.getElementById('key-provider').value = 'claude'`);
  r = await (async () => { await panelJs(`document.getElementById('key-form').requestSubmit()`); await wait(700); return panelJs(`({ msg: document.getElementById('key-msg').textContent, sw: document.getElementById('key-switch').hidden ? '' : document.getElementById('key-switch').textContent })`); })();
  check('wrong provider is refused with a fix', /looks like a Groq key/.test(r.msg) && /Save as Groq instead/.test(r.sw), JSON.stringify(r));
  r = await typeKey('sk-ant-api03-bad' + 'x'.repeat(30));
  check('rejected key is not saved', /rejected the API key/.test(r.msg) && !ctx.ai.hasKey('claude'), JSON.stringify(r));
  r = await typeKey('sk-ant-api03-' + 'C'.repeat(40));
  check('claude key saved', ctx.ai.hasKey('claude') && /2 Claude models/.test(r.msg), r.msg);
  r = await typeKey('AIzaSy' + 'D'.repeat(33));
  check('gemini key saved', ctx.ai.hasKey('gemini'), r.msg);
  r = await typeKey('sk-proj-' + 'E'.repeat(40));
  check('openai key saved', ctx.ai.hasKey('openai'), r.msg);
  const saved = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'ai.json'), 'utf8'));
  check('keys are not stored in plain text', !JSON.stringify(saved).includes('CCCCCCCCCC'));
  check('groq model list filtered', JSON.stringify(ctx.ai.modelList('groq').map((m) => m.id)) === '["llama-3.3-70b-versatile","openai/gpt-oss-120b"]', JSON.stringify(ctx.ai.modelList('groq')));
  const pageState = await panelJs('document.body.innerText');
  check('panel never shows a full key', !pageState.includes('C'.repeat(10)) && pageState.includes('sk-ant-api…CCCC'));
  log('panel tab', await panelJs(`({ chipHidden: document.getElementById('use-page').hidden, name: document.getElementById('page-name').textContent })`));
  await shoot('keys');

  // ---- chat with each provider, streamed ----
  const ask = async (provider, text, withPage) => {
    log('ask', provider);
    ctx.ai.setActive(provider);
    w.panelSend({ type: 'ai-state' });
    await wait(300);
    w.openPanel('ai');
    await wait(300);
    await panelJs(`(() => { const b = document.getElementById('use-page'); if ((b.getAttribute('aria-pressed') === 'true') !== ${!!withPage}) b.click(); const i = document.getElementById('input'); i.value = ${JSON.stringify(text)}; document.getElementById('composer').requestSubmit(); })()`);
    log('submitted');
    await until(() => panelJs(`!document.body.classList.contains('busy') && document.querySelectorAll('.msg.assistant').length > 0`), 8000);
    log('answered');
    await wait(300);
    return panelJs(`(() => { const a = [...document.querySelectorAll('.msg.assistant')].pop(); return { text: a.innerText, html: a.querySelector('.answer').innerHTML.slice(0, 400), who: a.querySelector('.who').innerText }; })()`);
  };
  r = await ask('claude', 'Summarize this page', true);
  check('claude streams an answer with the page', /streamed/.test(r.text) && /with the page/.test(r.text) && /<strong>streamed<\/strong>/.test(r.html) && /<pre/.test(r.html), r.text.slice(0, 160));
  check('answer shows provider and model', /Claude/.test(r.who) && /claude-sonnet-5-5/.test(r.who), r.who);
  await shoot('chat-claude');
  r = await ask('gemini', 'And in one line?', false);
  check('gemini answers in the same chat', /Gemini, 3 turns/.test(r.text), r.text.slice(-60));
  r = await ask('groq', 'Hi', false);
  check('groq answers', /Groq, model llama-3.3-70b-versatile/.test(r.text), r.text.slice(-60));
  r = await ask('openai', 'Hi', false);
  check('chatgpt answers', /ChatGPT, model gpt-5.4-mini/.test(r.text), r.text.slice(-60));
  await shoot('chat-all');

  // Requests went to the right place, each in its own format (logged by the mock).
  const reqs = fs.readFileSync(process.env.LANTERN_AI_MOCK_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.body);
  const by = (host) => reqs.filter((x) => x.url.includes(host)).pop();
  const c = by('anthropic.com/v1/messages');
  check('claude request format', c && c.headers.includes('x-api-key') && c.headers.includes('anthropic-version') && c.body.stream === true && c.body.messages[0].role === 'user');
  const withPage = reqs.find((x) => x.url.includes('anthropic.com/v1/messages'));
  check('page text is attached to the question', withPage && /<page title="How lanterns work" url="http:\/\/127\.0\.0\.1:\d+\/article\.html">/.test(withPage.body.system) && withPage.body.system.includes('trimmed so the flame'), withPage && withPage.body.system.slice(-300));
  const g = by('generativelanguage');
  check('gemini request format', g && g.url.includes(':streamGenerateContent?alt=sse') && g.headers.includes('x-goog-api-key') && g.body.contents[1].role === 'model');
  const q = by('api.groq.com');
  check('groq request format', q && q.url === 'https://api.groq.com/openai/v1/chat/completions' && q.headers.includes('authorization') && q.body.messages[0].role === 'system');
  const o = by('api.openai.com/v1/chat');
  check('openai request format', o && o.body.max_completion_tokens > 0 && o.body.model === 'gpt-5.4-mini');

  // ---- reading mode and share ----
  w.openPanel('reader');
  await wait(1500);
  const reader = await panelJs(`({ h: document.querySelector('#article h1') && document.querySelector('#article h1').textContent, n: document.querySelectorAll('#article p').length, meta: document.getElementById('r-meta').textContent, nav: document.getElementById('article').innerText.includes('Home · About') })`);
  log('reader-debug', await panelJs(`window.lantern.panelRead().then((p) => p ? { t: p.title, n: p.blocks.length } : 'null').catch((e) => 'ERR ' + e.message)`), await panelJs(`({ empty: document.getElementById('r-empty').hidden, loading: document.getElementById('r-loading').hidden, view: document.getElementById('v-reader').hidden })`));
  check('reading mode extracts the article', reader.h === 'How lanterns work' && reader.n > 10 && !reader.nav, JSON.stringify(reader));
  await shoot('reader');
  w.openPanel('share');
  await wait(800);
  const share = await panelJs(`({ url: document.getElementById('s-url').value, qr: document.getElementById('s-qr').src.length })`);
  check('share shows link and QR', share.url.endsWith('/article.html') && share.qr > 500, JSON.stringify(share));
  await shoot('share');
  w.closePanel();

  // ---- omnibox: history suggestions and inline completion ----
  await w.activeWc().loadURL(`${base}/two.html`);
  await wait(500);
  w.win.webContents.focus();
  await w.win.webContents.executeJavaScript(`(() => { const a = document.getElementById('address'); a.focus(); a.dispatchEvent(new Event('focus')); })()`);
  await wait(200);
  await w.win.webContents.executeJavaScript(`(() => { const a = document.getElementById('address'); a.value = '127'; a.setSelectionRange(3, 3); a.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '7' })); })()`);
  await wait(900);
  const omni = await w.win.webContents.executeJavaScript(`({ v: document.getElementById('address').value, s: document.getElementById('address').selectionStart })`);
  check('inline completion from history', omni.v.startsWith('127.0.0.1:') && omni.s === 3, JSON.stringify(omni));
  check('history and AI in suggestions', (w.suggestItems || []).some((x) => x.type === 'history' || x.type === 'bookmark'), JSON.stringify((w.suggestItems || []).map((x) => x.type)));
  await w.win.webContents.executeJavaScript(`(() => { const a = document.getElementById('address'); a.value = 'how do lanterns'; a.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 's' })); })()`);
  await wait(900);
  check('ask AI suggestion', (w.suggestItems || []).some((x) => x.type === 'ai' && x.sub === 'Ask ChatGPT'), JSON.stringify((w.suggestItems || []).map((x) => x.type + ':' + (x.sub || ''))));
  await shoot('omnibox');
  await w.win.webContents.executeJavaScript(`(() => { const a = document.getElementById('address'); a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); a.blur(); })()`);
  w.hideSuggestions();
  await wait(300);

  // ---- tabs: pin, mute, close and reopen ----
  const t2 = w.createTab(`${base}/three.html`);
  await wait(600);
  w.setPinned(t2.id, true);
  check('pinned tab moves first', w.order[0] === t2.id);
  w.toggleMute(t2.id);
  check('mute works', w.tabState(t2).muted === true);
  w.closeTab(t2.id);
  const back = w.reopenClosed();
  await wait(500);
  check('reopen closed tab keeps pin', back && back.pinned && back.url.endsWith('/three.html') && w.order[0] === back.id);
  await shoot('tabs');

  // ---- every menu builds ----
  let menusOk = true;
  for (const [name, fn] of [['tab', () => w.showTabMenu(w.activeId, 10, 10)], ['ai', () => t.showAiMenu(w, 10, 10)], ['bookmark', () => w.showBookmarkMenu(ctx.library.listBookmarks()[0].id, 10, 10)], ['main', () => t.showMainMenu(w, 10, 10)], ['app', () => t.refreshAppMenu()]]) {
    try { fn(); } catch (err) { menusOk = false; log('menu error', name, err.stack); }
  }
  check('menus build', menusOk);
  await wait(300);

  // ---- library page ----
  openLibrary(w, 'history');
  await wait(1200);
  const libH = await w.activeWc().executeJavaScript(`document.querySelectorAll('#h-list .entry').length`);
  check('history page lists visits', libH >= 3, String(libH));
  await shoot('library-history');
  openLibrary(w, 'bookmarks');
  await wait(900);
  check('bookmarks page lists bookmarks', (await w.activeWc().executeJavaScript(`document.querySelectorAll('#b-list .entry').length`)) === 1);
  await shoot('library-bookmarks');

  // ---- settings: AI section, custom colour validated by Rust ----
  w.activeWc().loadURL('lantern://app/settings.html#ai');
  await wait(1500);
  await shoot('settings-ai');
  let refused = false;
  try { await w.activeWc().executeJavaScript(`window.lantern.setSetting('mailUrl', 'javascript:alert(1)')`); } catch { refused = true; }
  check('rust refuses unsafe mail address', refused && ctx.settings.mailUrl === '');
  await w.activeWc().executeJavaScript(`window.lantern.setSetting('mailUrl', 'https://webmail.example.org/').then(() => window.lantern.setSetting('mailService', 'custom'))`);
  check('custom mail link saved', ctx.mail().url === 'https://webmail.example.org/');
  await w.activeWc().executeJavaScript(`window.lantern.setSetting('customAccent', '#22c55e')`);
  await wait(500);
  check('custom colour palette from rust', ctx.palette() && ctx.palette().light.contrast >= 4.5);
  w.activeWc().loadURL('lantern://app/settings.html#appearance');
  await wait(1500);
  await shoot('settings-colour');
  w.activeWc().loadURL(`lantern://app/search.html?q=${encodeURIComponent('lanterns')}`);
  await wait(1500);
  await shoot('search-page');

  // ---- 1.7: Lantern Search, our own engine (fixtures stand in for the sources) ----
  if (process.env.LANTERN_FIXTURES) {
    process.env.LANTERN_FIXTURE_BASE = base;
    process.env.LANTERN_INDEX_LOCAL = '1'; // the test server is on 127.0.0.1, which real browsing never indexes
    ctx.settings.indexPages = true; ctx.settings.saveHistory = true;
    await load(`${base}/article`);
    const indexed = await until(() => ctx.pageIndex.count() >= 1, 8000);
    check('visited page is added to the local index', indexed, String(ctx.pageIndex.count()));
    const local = ctx.pageIndex.search('chimney wick');
    check('local index finds it by its words', local.length && /article/.test(local[0].url), JSON.stringify(local.map((r) => r.url)));
    await load(`${base}/login-form`);
    await w.activeWc().executeJavaScript(`document.body.innerHTML = '<h1>Sign in</h1><input type=password>' + 'x '.repeat(300)`);
    check('sign-in pages are never indexed', !require('../src/pageindex').PageIndex.allowed(`${base}/login`) && ctx.pageIndex.count() === 1);
    await load('lantern://app/search.html?q=' + encodeURIComponent('lantern chimney'));
    const ok = await until(() => w.activeWc().executeJavaScript(`document.querySelectorAll('#results .result a').length >= 4`), 8000);
    check('Lantern Search shows merged results', ok);
    const info = await w.activeWc().executeJavaScript(`({ first: [...document.querySelectorAll('#results .result')].slice(0, 6).map((li) => li.querySelector('.t').textContent + ' [' + [...li.querySelectorAll('.from')].map((f) => f.textContent).join(',') + ']'), panel: document.getElementById('panel-title').textContent, line: document.getElementById('sources-line').textContent })`);
    log('search results', info);
    check('a page found by several sources ranks first', /How lanterns work/.test(info.first[0]) && /Visited/.test(info.first[0]), info.first[0]);
    check('knowledge panel from Wikipedia', info.panel === 'Lantern', info.panel);
    check('sources line names every source', /Your pages/.test(info.line) && /Wikipedia/.test(info.line) && /Mwmbl/.test(info.line) && /Marginalia/.test(info.line), info.line);
    const fx = require('./fixture-fetch');
    check('nothing went to DuckDuckGo', !fx.calls.some((c) => /duckduckgo/.test(c)) && !t.serviceLog.some((r) => /duckduckgo/.test(r.host)));
    await shoot('lantern-search');
    const ans = await (async () => { await load('lantern://app/search.html?q=' + encodeURIComponent('5 ft in cm')); return w.activeWc().executeJavaScript(`document.getElementById('answer').textContent`); })();
    check('instant answer on the results page', /152\.4 cm/.test(ans), ans);
    ctx.pageIndex.clear();
  }

  // ---- 1.7: desk on the new tab ----
  await load('lantern://app/newtab.html');
  await wait(600);
  const desk = await w.activeWc().executeJavaScript(`({ widgets: document.querySelectorAll('#desk .w:not([hidden])').length })`);
  check('desk shows its widgets', desk.widgets === 7, JSON.stringify(desk));
  const inst = await w.activeWc().executeJavaScript(`(() => { const q = document.getElementById('q'); q.value = '18% of 2400'; q.dispatchEvent(new Event('input')); const b = document.getElementById('instant'); return b.hidden ? '' : b.textContent; })()`);
  check('instant answer under the new tab search box', /432/.test(inst), inst);
  await w.activeWc().executeJavaScript(`document.getElementById('q').value=''; document.getElementById('q').dispatchEvent(new Event('input')); document.getElementById('q').blur(); document.body.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))`);
  check('? opens the keyboard shortcuts', await w.activeWc().executeJavaScript(`!document.getElementById('keys-sheet').hidden && document.querySelectorAll('#keys-list .k').length > 8`));
  await w.activeWc().executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  const qrOk = await w.activeWc().executeJavaScript(`(async () => { document.querySelector('[data-tool="qr"]').click(); const i = document.getElementById('qr-in'); i.value = 'https://example.com'; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 500)); return !!document.querySelector('#qr-out svg'); })()`);
  check('toolbox QR code from the Rust core', qrOk);
  const clean = await w.activeWc().executeJavaScript(`(async () => { document.querySelector('[data-tool="clean"]').click(); const i = document.getElementById('cl-in'); i.value = 'https://example.com/a?utm_source=x&id=7&fbclid=1'; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 300)); return document.getElementById('cl-out').textContent; })()`);
  check('toolbox cleans links', clean === 'https://example.com/a?id=7', clean);
  await w.activeWc().executeJavaScript(`window.scrollTo(0, 700)`);
  await wait(400);
  await shoot('desk');
  await w.activeWc().executeJavaScript(`window.scrollTo(0, 0)`);

  // ---- 1.7: a page going fullscreen covers the tabs and toolbar ----
  await load(`${base}/video`);
  await w.activeWc().executeJavaScript(`document.documentElement.requestFullscreen()`, true).catch(() => {});
  const full = await until(() => { const b = w.tabs.get(w.activeId).view.getBounds(); const [cw, ch] = w.win.getContentSize(); return b.y === 0 && b.x === 0 && w.win.isFullScreen() && b.width >= cw && b.height >= ch; }, 5000);
  check('fullscreen video covers the whole window', full, JSON.stringify([w.tabs.get(w.activeId).view.getBounds(), w.win.getContentSize(), w.win.isFullScreen()]));
  await w.activeWc().executeJavaScript(`document.exitFullscreen()`, true).catch(() => {});
  const unfull = await until(() => w.tabs.get(w.activeId).view.getBounds().y === w.uiHeight(), 5000);
  check('leaving fullscreen brings the toolbar back', unfull, JSON.stringify(w.tabs.get(w.activeId).view.getBounds()));
  await wait(800);

  // ---- private window ----
  const pw = await openPrivateWindow(ctx);
  pw.win.setContentSize(1280, 820);
  pw.win.showInactive();
  await wait(2000);
  await shoot('private', pw);
  const before = ctx.library.queryHistory({}).length;
  await pw.activeWc().loadURL(`${base}/secret.html`);
  await wait(600);
  check('private window keeps no history', ctx.library.queryHistory({}).length === before);
  check('private session is separate', pw.ctx.session !== ctx.session && pw.ctx.isPrivate);
  pw.win.close();
  await wait(800);
  check('private context ends with its window', !contexts.has(pw.ctx.id));

  // ======================= 1.6 =======================
  const { setTabSetting, toggleTabLayout, getServices, serviceLog, importer, openAppWindow, tabLayoutMenu, appsMenu } = t;
  // Full window picture: the frame plus each visible page placed where it sits (stitched later).
  const shootFull = async (name, win = w) => {
    fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-full-ui.png`), (await win.win.webContents.capturePage()).toPNG());
    const panes = (win.layoutInfo && win.layoutInfo.panes) || [];
    const meta = [];
    for (const [i, p] of panes.entries()) {
      const tab = win.tabs.get(p.id);
      if (!tab || !tab.view) continue;
      fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-full-pane${i}.png`), (await tab.view.webContents.capturePage()).toPNG());
      meta.push({ i, x: p.x, y: p.y, w: p.width, h: p.height });
    }
    if (win.panelOpen && win.panel) { win.closePanel(); }
    fs.writeFileSync(path.join(TEST_SHOT_DIR, `${name}-full.json`), JSON.stringify(meta));
  };

  // bangs
  check('bang prefix', core.bangs.resolve('!w lantern').url.startsWith('https://en.wikipedia.org/'));
  const sugg = await w.win.webContents.executeJavaScript(`window.lanternUI.suggest('!y', false)`);
  check('bang suggestions', sugg.some((x) => x.type === 'bang' && x.trigger === 'yt'), sugg.map((x) => x.trigger).join(','));
  const sugg2 = await w.win.webContents.executeJavaScript(`window.lanternUI.suggest('lantern history !w', false)`);
  check('bang suffix suggestion', sugg2[0] && sugg2[0].type === 'bang', sugg2[0] && sugg2[0].text);
  await load(`${base}/start.html`);
  w.win.webContents.send('focus-omnibox-text', '!gh lantern browser');
  await wait(400);
  await shoot('bangs');
  w.send('omnibox-done');
  await w.activeWc().executeJavaScript('1');
  // tracking parameters stripped before load
  await load(`${base}/clean.html?id=7&utm_source=news&fbclid=abc`);
  await wait(300);
  check('tracking parameters stripped', w.activeWc().getURL() === `${base}/clean.html?id=7`, w.activeWc().getURL());

  // tab groups
  for (const p of ['/g1.html', '/g2.html', '/g3.html']) w.createTab(base + p, { activate: false });
  await wait(1200);
  const ids = w.order.slice(-3);
  const grp = w.addToGroup(ids[0]);
  grp.name = 'Research';
  w.addToGroup(ids[1], grp.id);
  const g2 = w.addToGroup(ids[2]);
  g2.name = 'Shopping'; g2.color = 'green';
  w.broadcast();
  check('groups keep tabs together', w.order.indexOf(ids[1]) === w.order.indexOf(ids[0]) + 1);
  check('groups listed in state', w.groups.size === 2);
  await wait(500);
  await shoot('groups');

  // split view
  w.activateTab(ids[0]);
  w.splitWith(ids[1], ids[0]);
  await wait(900);
  check('split view shows two pages', w.panes().length === 2 && w.layoutInfo.panes.length === 2, JSON.stringify(w.layoutInfo.panes.map((p) => p.width)));
  w.split.ratio = 0.35; w.layout();
  await wait(300);
  check('split ratio applies', w.layoutInfo.panes[0].width < w.layoutInfo.panes[1].width);
  await shootFull('split');
  w.tabs.get(ids[1]).view.webContents.focus();
  await wait(300);
  check('clicking the other pane makes it active', w.activeId === ids[1], `${w.activeId} vs ${ids[1]}`);
  w.closeSplit();
  await wait(300);
  check('closing split shows one page', w.panes().length === 1);

  // vertical tabs + compact
  setTabSetting(ctx, 'tabLayout', 'vertical');
  await wait(900);
  check('vertical tabs move the page right', w.layoutInfo.vertical && w.layoutInfo.panes[0].x === w.layoutInfo.side, JSON.stringify(w.layoutInfo.panes[0]));
  await shootFull('vertical');
  setTabSetting(ctx, 'tabsCollapsed', true);
  await wait(700);
  check('collapsed sidebar is narrow', w.layoutInfo.side === 52);
  await shootFull('vertical-collapsed');
  setTabSetting(ctx, 'tabsCollapsed', false);
  setTabSetting(ctx, 'tabSide', 'right');
  setTabSetting(ctx, 'compactMode', true);
  await wait(800);
  check('sidebar on the right', w.layoutInfo.sideRight && w.layoutInfo.panes[0].x === 0);
  check('compact frame is shorter', w.layoutInfo.toolbar === 38 && w.layoutInfo.top === 38 + w.layoutInfo.bar, String(w.layoutInfo.top));
  await shootFull('vertical-right-compact');
  setTabSetting(ctx, 'tabSide', 'left');
  setTabSetting(ctx, 'compactMode', false);
  toggleTabLayout(ctx);
  await wait(800);
  check('back to tabs on top', !w.layoutInfo.vertical && w.layoutInfo.top === 84 + (ctx.settings.bookmarksBar ? 32 : 0), String(w.layoutInfo.top));

  // MRU switching
  ctx.settings.mruTabSwitching = true;
  w.activateTab(ids[2]); w.activateTab(ids[0]);
  const fake = { preventDefault() {} };
  w.handleShortcut(fake, { type: 'keyDown', key: 'Tab', control: true, shift: false });
  check('ctrl+tab goes to the last used tab', w.activeId === ids[2], `${w.activeId}`);
  w.handleShortcut(fake, { type: 'keyUp', key: 'Control' });
  ctx.settings.mruTabSwitching = false;

  // shields + fingerprinting
  await load(`${base}/fp.html`);
  const fp1 = await w.activeWc().executeJavaScript(`(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 50; const x = c.getContext('2d'); x.font = '20px sans-serif'; x.fillStyle = '#f60'; x.fillText('Lantern fingerprint', 4, 30); return [c.toDataURL(), c.toDataURL(), navigator.hardwareConcurrency]; })()`);
  check('canvas readings are stable within a site', fp1[0] === fp1[1]);
  const plain = await w.win.webContents.executeJavaScript(`(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 50; const x = c.getContext('2d'); x.font = '20px sans-serif'; x.fillStyle = '#f60'; x.fillText('Lantern fingerprint', 4, 30); return c.toDataURL(); })()`);
  check('canvas readings differ from the real ones', fp1[0] !== plain);
  const site = '127.0.0.1';
  ctx.settings.siteShields = { [site]: { off: true } };
  await load(`${base}/fp.html`);
  const fp2 = await w.activeWc().executeJavaScript(`(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 50; const x = c.getContext('2d'); x.font = '20px sans-serif'; x.fillStyle = '#f60'; x.fillText('Lantern fingerprint', 4, 30); return c.toDataURL(); })()`);
  check('shields down turns protection off for the site', fp2 === plain);
  check('state says shields are down', w.tabState(w.activeTab()).shields === false);
  await shoot('shields-down');
  ctx.settings.siteShields = {};

  // services + DNS
  check('services default on', getServices().trackerLists && getServices().threatLists);
  const sv = await w.activeWc().executeJavaScript('1').then(() => null);
  await load('lantern://app/settings.html#privacy');
  await wait(1200);
  const svc = await w.activeWc().executeJavaScript(`window.lantern.services()`);
  check('services log is readable', Array.isArray(svc.log) && svc.startedAt > 0, `${svc.log.length} entries`);
  await w.activeWc().executeJavaScript(`document.getElementById('svc-dns').scrollIntoView({ block: 'center' })`);
  await wait(400);
  await shoot('settings-privacy');
  await load('lantern://app/settings.html#tabs');
  await wait(900);
  await shoot('settings-tabs');
  await load('lantern://app/settings.html#search');
  await wait(900);
  await w.activeWc().executeJavaScript(`document.getElementById('bang-form').scrollIntoView({ block: 'center' })`);
  const added = await w.activeWc().executeJavaScript(`(async () => { await window.lantern.setSetting('customBangs', [{ trigger: 'lt', name: 'Lantern test', url: '${base}/q?x={q}' }]); return true; })()`);
  ctx.settings.customBangs = (await w.activeWc().executeJavaScript(`window.lantern.info()`)).settings.customBangs;
  check('custom bang works', core.bangs.resolve('!lt hello', ctx.settings.customBangs).url === `${base}/q?x=hello`);
  await wait(500);
  await shoot('settings-bangs');

  // import from a bookmarks file
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Bookmarks bar</H3><DL><p><DT><A HREF="https://example.org/a" ADD_DATE="1700000000">Example A</A><DT><H3>Recipes</H3><DL><p><DT><A HREF="https://food.example/soup">Soup &amp; bread</A></DL><p></DL><p></DL>`;
  const parsed = importer.parseBookmarksHtml(html);
  check('bookmarks file parses with folders', parsed.length === 2 && parsed[1].folder === 'Recipes' && parsed[1].title === 'Soup & bread', JSON.stringify(parsed));
  const n = ctx.library.importBookmarks(parsed);
  check('imported bookmarks are added once', n === 2 && ctx.library.importBookmarks(parsed) === 0);
  check('export makes a bookmarks file', ctx.library.exportHtml().includes('<H3>Recipes</H3>'));
  check('browser sources listed without error', Array.isArray(importer.listSources()));
  await load('lantern://app/settings.html#import');
  await wait(1200);
  await shoot('settings-import');

  // @tabs search
  const tabsSugg = await w.win.webContents.executeJavaScript(`window.lanternUI.suggest('@tabs g2', false)`);
  check('@tabs finds open tabs', tabsSugg.length >= 1 && tabsSugg[0].type === 'tab', JSON.stringify(tabsSugg.map((x) => x.sub)));

  // site app window
  const before16 = require('electron').BrowserWindow.getAllWindows().length;
  const appWin = openAppWindow(ctx, { id: 'test', name: 'Test app', url: `${base}/app.html` });
  await wait(1200);
  check('app opens in its own window', require('electron').BrowserWindow.getAllWindows().length === before16 + 1 && appWin.webContents.getURL().endsWith('/app.html'));
  appWin.close();
  check('layout and apps menus build', tabLayoutMenu(w).length > 5 && appsMenu(w).length >= 2);

  // incognito badge
  const pw2 = await openPrivateWindow(ctx);
  pw2.win.setContentSize(1280, 820);
  pw2.win.showInactive();
  await wait(1500);
  const badge = await pw2.win.webContents.executeJavaScript(`document.getElementById('private-badge').textContent.trim()`);
  check('incognito window is labelled', badge === 'Incognito', badge);
  await shoot('incognito', pw2);
  pw2.win.close();
  await wait(600);

  server.close();
  const failed = results.filter((x) => !x.ok);
  log(`DONE ${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.name).join(', ') : ''}`);
};
