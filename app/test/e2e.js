'use strict';
// End-to-end test of Lantern 1.5 in a real Electron window (development only).
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
  check('rust core loads', core.version() === '1.5.0', core.version());

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

  server.close();
  const failed = results.filter((x) => !x.ok);
  log(`DONE ${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.name).join(', ') : ''}`);
};
