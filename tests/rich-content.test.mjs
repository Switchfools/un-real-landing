import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, narrationText } from '../scripts/essays.mjs';
import { renderSnippet, renderDiagram } from '../scripts/rich-content.mjs';
import { listVoices, voicePreview } from '../scripts/voices.mjs';

test('explicit HTML snippets retain useful formatting and remove executable content and tracking', () => {
  const payload = '<details open id="preview"><summary onclick="alert(1)">Why?</summary><p style="position:fixed">A <strong>reason</strong>.</p></details><script>alert(1)</script><svg><a href="javascript:alert(1)">Bad</a></svg><math><mtext><img src=x onerror=alert(1)></mtext></math><iframe srcdoc="<script>alert(1)</script>"></iframe><form action="https://example.com"><input name="__proto__"></form><a href="java&#x0a;script:alert(1)">link</a><img src="https://tracker.example.com/a" onerror="alert(1)"><figure><img src="../../assets/essays/a-belief/photo.png" alt="A belief"><figcaption>Caption</figcaption></figure>';
  const html = renderMarkdown('```html\n' + payload + '\n```').html;
  assert.match(html, /<details open><summary>Why\?<\/summary>/);
  assert.match(html, /<strong>reason<\/strong>/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/essays\/a-belief\/photo.png"/);
  assert.doesNotMatch(html, /<script|<svg|<math|<iframe|<form|<input|onclick|onerror|javascript:|tracker|style=|id="preview"/);
  assert.match(renderMarkdown('<script>alert(1)</script>').html, /&lt;script&gt;/);
  assert.throws(() => renderSnippet('x'.repeat(20001)), /20 KB/);
});

test('diagram blocks produce static accessible diagrams and reject oversized or ambiguous structures', () => {
  const diagram = { title: 'Ideas & action', nodes: [{ id: 'idea', label: '<script>alert(1)</script>' }, { id: 'action', label: 'Test the idea' }], edges: [{ from: 'idea', to: 'action', label: 'Review first' }] };
  const html = renderMarkdown('```diagram\n' + JSON.stringify(diagram) + '\n```').html;
  assert.match(html, /<svg[^>]*role="img"/); assert.match(html, /Diagram in words/);
  assert.match(html, /Review first/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script/);
  assert.throws(() => renderDiagram(JSON.stringify({ ...diagram, edges: [{ from: 'idea', to: 'missing' }] })), /Invalid diagram/);
  assert.throws(() => renderDiagram(JSON.stringify({ ...diagram, nodes: [diagram.nodes[0], diagram.nodes[0]] })), /Invalid diagram/);
  assert.throws(() => renderDiagram(JSON.stringify({ ...diagram, nodes: [{ id: 'x', label: 'X', column: Infinity }] })), /Invalid diagram/);
  const spoken = narrationText({ metadata: {}, body: '```diagram\n' + JSON.stringify(diagram) + '\n```\n```html\n<p>Useful idea.</p><script>privateAttack()</script>\n```' });
  assert.match(spoken, /Diagram: Ideas & action/); assert.match(spoken, /Useful idea/); assert.doesNotMatch(spoken, /"nodes"|privateAttack/);
});

test('voice samples are authenticated reads with bounded audio and no credentials sent to sample hosts', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/v2/voices')) return Response.json({ voices: [{ voice_id: 'voice1', name: 'Reader', preview_url: 'https://api.us.elevenlabs.io/sample.mp3' }] });
    if (url.includes('/v1/voices')) return Response.json({ name: 'Reader', preview_url: 'https://api.us.elevenlabs.io/sample.mp3' });
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  assert.equal((await listVoices('test-key', fetcher))[0].hasPreview, true);
  const sample = await voicePreview('test-key', 'voice1', fetcher);
  assert.equal(sample.type, 'audio/mpeg'); assert.equal(Buffer.from(sample.data, 'base64').toString(), 'audio');
  assert.ok(calls.every(call => !call.options.method || call.options.method === 'GET'));
  assert.equal(calls.at(-1).options.headers, undefined); assert.equal(calls.at(-1).options.redirect, 'error');
  await assert.rejects(voicePreview('test-key', 'voice1', async () => Response.json({ preview_url: 'http://169.254.169.254/latest/meta-data/' })), /no supported library sample/);
  await assert.rejects(voicePreview('test-key', 'voice1', async () => Response.json({ preview_url: 'https://api.elevenlabs.io.evil.example/attack' })), /no supported library sample/);
  await assert.rejects(listVoices('', fetcher), /local .env/);
  await assert.rejects(voicePreview('test-key', 'voice1', async url => url.includes('/v1/') ? Response.json({ preview_url: 'https://api.elevenlabs.io/sample' }) : new Response('<script>attack</script>', { headers: { 'content-type': 'text/html' } })), /unavailable/);
  await assert.rejects(voicePreview('test-key', 'voice1', async url => url.includes('/v1/') ? Response.json({ preview_url: 'https://api.elevenlabs.io/sample' }) : new Response(new Uint8Array(3_000_001), { headers: { 'content-type': 'audio/mpeg' } })), /too large/);
});
