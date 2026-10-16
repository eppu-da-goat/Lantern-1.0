'use strict';
// The links at the top right of Lantern Search and the New Tab page: your web mail (Gmail,
// Outlook, Proton Mail… or any address you choose) and the AI assistant. The mail address is
// checked and built by Lantern's Rust core.
(() => {
  const api = window.lantern;
  const slot = document.querySelector('[data-toplinks]');
  if (!api || !slot) return;

  const ICON = {
    mail: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="11" rx="2"/><path d="m3.5 6 6.5 5 6.5-5"/></svg>',
    spark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6z"/></svg>',
    down: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>',
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3 3 7-7"/></svg>',
  };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const box = el('div', 'toplinks');
  const mail = el('a', 'tl-link tl-mail');
  const pick = el('button', 'tl-pick');
  pick.type = 'button';
  pick.title = 'Choose your mail';
  pick.setAttribute('aria-label', 'Choose your mail');
  pick.setAttribute('aria-haspopup', 'menu');
  pick.innerHTML = ICON.down;
  const mailGroup = el('div', 'tl-group');
  mailGroup.append(mail, pick);
  const ai = el('button', 'tl-link tl-ai');
  ai.type = 'button';
  const menu = el('div', 'tl-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  box.append(mailGroup, ai, menu);
  slot.append(box);

  let info = null;
  async function render() {
    info = await api.info();
    const m = info.mail || {};
    const show = info.settings.mailService !== 'off' && m.url;
    mail.hidden = !show;
    if (show) {
      mail.href = m.url;
      mail.innerHTML = ICON.mail;
      mail.append(el('span', '', m.name || 'Mail'));
      mail.title = `Open ${m.name || 'your mail'} (${m.host})`;
    }
    pick.classList.toggle('alone', !show);
    if (!show) { pick.innerHTML = ICON.mail + ICON.down; pick.title = 'Add a Mail link'; } else pick.innerHTML = ICON.down;
    const a = info.ai || {};
    ai.innerHTML = ICON.spark;
    ai.append(el('span', '', a.name ? `Ask ${a.name}` : 'AI'));
    ai.title = a.name ? `Open the AI assistant (${a.name})` : 'Set up the AI assistant';
    ai.hidden = info.settings.showAiButton === false;
  }
  ai.addEventListener('click', () => api.panelOpen('ai', info && info.ai && info.ai.active ? {} : { view: 'keys' }).catch(() => {}));

  function closeMenu() { menu.hidden = true; pick.setAttribute('aria-expanded', 'false'); }
  function openMenu() {
    menu.textContent = '';
    menu.append(el('p', 'tl-head', 'Mail link opens'));
    const current = info.settings.mailService || 'gmail';
    for (const s of info.mailServices) {
      if (s.id === 'custom') continue;
      const b = el('button', 'tl-item');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(current === s.id));
      b.innerHTML = current === s.id ? ICON.check : '<span class="sp"></span>';
      b.append(el('span', '', s.name));
      if (s.url) b.append(el('span', 'tl-host', new URL(s.url).host));
      b.addEventListener('click', async () => {
        info.settings = await api.setSetting('mailService', s.id);
        closeMenu();
        render();
      });
      menu.append(b);
    }
    // Any other web mail: type its address. Only secure https addresses are accepted.
    const form = el('form', 'tl-custom');
    const label = el('label', '', 'Your own web mail');
    const input = el('input');
    input.type = 'url';
    input.placeholder = 'https://mail.example.com';
    input.value = info.settings.mailUrl || '';
    input.setAttribute('aria-label', 'Web mail address');
    const save = el('button', 'tl-save', current === 'custom' ? 'Update' : 'Use');
    save.type = 'submit';
    const err = el('p', 'tl-err');
    err.hidden = true;
    const row = el('div', 'tl-row');
    row.append(input, save);
    form.append(label, row, err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let v = input.value.trim();
      if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      try {
        await api.mailPreview('custom', v);
        await api.setSetting('mailUrl', v);
        info.settings = await api.setSetting('mailService', 'custom');
        closeMenu();
        render();
      } catch (e2) {
        err.hidden = false;
        err.textContent = String(e2.message || e2).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      }
    });
    menu.append(form);
    menu.hidden = false;
    pick.setAttribute('aria-expanded', 'true');
  }
  pick.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) openMenu(); else closeMenu(); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); pick.focus(); } });
  window.addEventListener('focus', () => render().catch(() => {}));
  render().catch(() => {});
})();
