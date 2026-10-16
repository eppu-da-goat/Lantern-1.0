'use strict';
(() => {
  const api = window.lantern;
  const $ = (id) => document.getElementById(id);
  document.querySelectorAll('[data-i]').forEach((n) => n.style.setProperty('--i', n.dataset.i));
  const params = new URLSearchParams(location.search);
  const type = params.get('type') || 'crash';
  const url = params.get('url') || '';
  const code = params.get('code') || '';
  let host = url;
  try { host = new URL(url).host; } catch {}

  const COPY = {
    phishing: {
      tone: 'danger', icon: 'icon-danger', title: 'Deceptive site ahead',
      lede: 'This site is on a list of known scams. It may try to trick you into entering a password, card number or other personal details.',
      primary: 'Back to safety',
      detail: 'Lantern checked this address against an open list of phishing sites stored on your device. The check never left your computer. If you believe this is a mistake, you can still visit, but don\'t enter any personal information.',
      proceed: 'Visit this unsafe site',
    },
    malware: {
      tone: 'danger', icon: 'icon-danger', title: 'This site spreads harmful software',
      lede: 'Visiting it could install programs that steal information, show ads or damage files on your computer.',
      primary: 'Back to safety',
      detail: 'Lantern checked this address against an open list of malware sites stored on your device. The check never left your computer.',
      proceed: 'Visit this unsafe site',
    },
    cert: {
      tone: 'cert', icon: 'icon-lock', title: 'Your connection isn\'t private',
      lede: 'Someone could be trying to read what you send to this site, such as passwords or messages. Its security certificate couldn\'t be trusted.',
      primary: 'Back to safety',
      detail: 'This can happen when a certificate has expired, belongs to a different site, or was issued by someone your computer doesn\'t trust. Public Wi-Fi login pages can also cause it.',
      proceed: 'Continue anyway (not secure)',
    },
    crash: {
      tone: 'crash', icon: 'icon-crash', title: 'This page stopped working',
      lede: 'Something went wrong while showing it. Your other tabs are fine.',
      primary: 'Reload',
      detail: 'The page\'s process ended unexpectedly. Reloading usually fixes it. If it keeps happening, the site may be using too much memory.',
      proceed: '',
    },
  };
  const c = COPY[type] || COPY.crash;
  document.body.classList.add(c.tone);
  document.title = c.title;
  $(c.icon).removeAttribute('hidden');
  $('title').textContent = c.title;
  $('lede').textContent = c.lede;
  $('host').textContent = host;
  $('primary').textContent = c.primary;
  $('detail-text').textContent = c.detail;
  $('code').textContent = code ? `Error: ${code}` : '';
  $('proceed').textContent = c.proceed;
  $('proceed').hidden = !c.proceed;

  $('primary').addEventListener('click', () => {
    if (type === 'crash') { location.replace(url); return; }
    if (history.length > 1) history.back();
    else location.replace('lantern://app/newtab.html');
  });
  $('details-toggle').addEventListener('click', () => {
    const open = $('details').hidden;
    $('details').hidden = !open;
    $('details-toggle').setAttribute('aria-expanded', String(open));
    $('details-toggle').textContent = open ? 'Hide details' : 'Details';
  });
  $('proceed').addEventListener('click', () => { if (api) api.safetyProceed(url, type); });
  $('primary').focus();
})();
