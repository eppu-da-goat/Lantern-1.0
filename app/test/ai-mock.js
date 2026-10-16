'use strict';
// Test-only stand-in for the AI services (used when LANTERN_AI_MOCK is set; never packaged).
// It answers like each real API would, in its own streaming format, so the Rust request
// builders and stream readers are exercised end to end.
function sse(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(c) {
      for (const ch of chunks) { c.enqueue(enc.encode(ch)); await new Promise((r) => setTimeout(r, 25)); }
      c.close();
    },
  });
}
const log = [];
async function mockFetch(url, opts = {}) {
  log.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
  if (process.env.LANTERN_AI_MOCK_LOG) require('fs').appendFileSync(process.env.LANTERN_AI_MOCK_LOG, JSON.stringify({ url, headers: Object.keys(opts.headers || {}), body: opts.body ? JSON.parse(opts.body) : null }) + '\n');
  const h = opts.headers || {};
  const key = h['x-api-key'] || h['x-goog-api-key'] || String(h.authorization || '').replace('Bearer ', '');
  if (/bad/i.test(key)) return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 });
  if (!opts.method || opts.method === 'GET') {
    if (url.includes('anthropic')) return Response.json({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }] });
    if (url.includes('groq')) return Response.json({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-120b' }] });
    if (url.includes('openai')) return Response.json({ data: [{ id: 'gpt-5.4-mini' }, { id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }] });
    return Response.json({ models: [{ name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] }] });
  }
  const body = JSON.parse(opts.body);
  const words = ['Here', ' is', ' a', ' **streamed**', ' answer', ' from', ' the', ' mock', '.\n\n', '- one\n', '- two\n\n', '```js\nconst x = 1;\n```'];
  const user = JSON.stringify(body).length;
  if (url.includes('anthropic')) {
    return new Response(sse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}\n\n',
      ...words.map((w) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } })}\n\n`),
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `\n\n(Claude saw ${user} bytes${body.system && body.system.includes('<page title=') ? ', with the page' : ''})` } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  if (url.includes('generativelanguage')) {
    return new Response(sse([...words, `\n\n(Gemini, ${body.contents.length} turns)`].map((w) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: w }] } }] })}\r\n\r\n`)), { status: 200 });
  }
  const who = url.includes('groq') ? 'Groq' : 'ChatGPT';
  return new Response(sse([...[...words, `\n\n(${who}, model ${body.model})`].map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`), 'data: [DONE]\n\n']), { status: 200 });
}
module.exports = { mockFetch, log };
