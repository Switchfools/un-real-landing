const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function previewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && /^api(?:\.(?:us|eu|in))?\.elevenlabs\.io$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}
async function provider(path, apiKey, fetcher) {
  if (!apiKey) throw fail('Connect ElevenLabs in the Audio panel. A local .env key is not deployed to the online Studio.');
  const response = await fetcher(`https://api.elevenlabs.io${path}`, { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw fail(`ElevenLabs returned ${response.status}. Check the key and its voices_read permission. A voice ID can still be used for narration if text_to_speech is enabled.`, 502);
  return response.json();
}
export async function listVoices(apiKey, fetcher = fetch) {
  const data = await provider('/v2/voices?page_size=100', apiKey, fetcher);
  return (data.voices || []).map(voice => ({ id: voice.voice_id, name: voice.name, description: Object.values(voice.labels || {}).join(' · '), hasPreview: Boolean(previewUrl(voice.preview_url)) }));
}
export async function voicePreview(apiKey, id, fetcher = fetch) {
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(id)) throw fail('Choose a valid voice ID.');
  const voice = await provider(`/v1/voices/${encodeURIComponent(id)}`, apiKey, fetcher);
  const url = previewUrl(voice.preview_url);
  if (!url) throw fail('This voice has no supported library sample. Use Generate short preview to hear your essay instead.');
  // Never forward credentials to a preview URL or follow redirects to arbitrary hosts.
  const response = await fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  const type = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4'].includes(type)) throw fail('The voice sample is unavailable. Try a short essay preview.', 502);
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.byteLength;
    if (size > 3_000_000) throw fail('The library sample is too large. Generate a short essay preview instead.', 502);
    parts.push(part);
  }
  if (!size) throw fail('The voice sample is empty.', 502);
  return { name: voice.name, type, data: Buffer.concat(parts).toString('base64') };
}
