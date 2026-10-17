'use strict';
// Canned answers for Lantern Search's sources, so the end-to-end test runs offline and never
// depends on anyone's servers. Used when LANTERN_FIXTURES=1. Anything else goes to the real fetch.
const calls = [];
const base = () => process.env.LANTERN_FIXTURE_BASE || 'http://127.0.0.1:9';
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body, headers: new Map([['content-type', 'application/json']]) });

async function fixtureFetch(url, opts) {
  const u = String(url);
  calls.push(u);
  if (/api\.mwmbl\.org\/search/.test(u)) {
    return json([
      { url: `${base()}/article`, title: [{ value: 'How ', is_bold: false }, { value: 'lanterns', is_bold: true }, { value: ' work', is_bold: false }], extract: [{ value: 'A lantern keeps a small flame safe from the wind.', is_bold: false }], source: 'mwmbl' },
      { url: 'https://en.wikipedia.org/wiki/Lantern', title: [{ value: 'Lantern - Wikipedia', is_bold: false }], extract: [{ value: 'A lantern is an often portable source of lighting.', is_bold: false }], source: 'wikipedia' },
      { url: 'https://lantern-makers.example/guide', title: [{ value: 'Making paper lanterns', is_bold: false }], extract: [{ value: 'Fold, glue and light.', is_bold: false }] },
    ]);
  }
  if (/api\.marginalia\.nu\/public\/search/.test(u)) {
    return json({ query: 'lanterns', license: 'CC-BY-NC-SA 4.0', results: [
      { url: 'https://smallweb.example/lanterns', title: 'My lantern collection', description: 'Notes on old railway lanterns.' },
      { url: `${base()}/article`, title: 'How lanterns work', description: 'Why the chimney matters.' },
    ] });
  }
  if (/wikipedia\.org\/w\/api\.php\?action=query&list=search/.test(u)) {
    return json({ query: { search: [
      { title: 'Lantern', snippet: 'A <span class="searchmatch">lantern</span> is an often portable source of lighting' },
      { title: 'Paper lantern', snippet: 'A paper <span class="searchmatch">lantern</span> is a lantern made of thin, brightly coloured paper' },
      { title: 'Lantern Festival', snippet: 'The <span class="searchmatch">Lantern</span> Festival is a festival' },
    ] } });
  }
  if (/wikipedia\.org\/w\/api\.php\?action=opensearch/.test(u)) return json(['lan', ['Lantern', 'Lantern Festival', 'Lanthanum'], [], []]);
  if (/wikipedia\.org\/api\/rest_v1\/page\/summary\//.test(u)) {
    return json({ type: 'standard', title: 'Lantern', description: 'Portable source of lighting', extract: 'A lantern is an often portable source of lighting, typically featuring a protective enclosure for the light source.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Lantern' } } });
  }
  if (/duckduckgo\.com/.test(u)) throw new Error('DuckDuckGo must never be called');
  return fetch(url, opts);
}

module.exports = { fixtureFetch, calls };
