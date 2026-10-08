import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, narrationHash, narrationText } from './essays.mjs';
import { fail } from './studio-store.mjs';

export function splitNarration(text, max = 3500) {
  const chunks = []; let current = '';
  for (const paragraph of text.split(/\n\n+/)) {
    const units = paragraph.length > max ? paragraph.match(/.{1,3000}(?:\s|$)|.{1,3000}/gs) : [paragraph];
    for (const unit of units || []) {
      if (current.length + unit.length + 2 > max && current) { chunks.push(current.trim()); current = ''; }
      current += `${current ? '\n\n' : ''}${unit}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export async function generateNarration({ document, slug, directory, apiKey, voiceId, narrator, sample = false, progress = () => {}, fetcher = fetch }) {
  if (!apiKey || !voiceId) throw fail('Connect ElevenLabs and choose a voice in the Audio panel first.');
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(voiceId)) throw fail('Invalid ElevenLabs voice ID.');
  const text = narrationText(document);
  const excerpt = text.slice(0, 600);
  const sentenceEnd = Math.max(excerpt.lastIndexOf('.'), excerpt.lastIndexOf('!'), excerpt.lastIndexOf('?'));
  const chunks = splitNarration(sample ? excerpt.slice(0, sentenceEnd > 120 ? sentenceEnd + 1 : excerpt.length).replace(/\s+$/, '') : text);
  const tracks = [], requestIds = [];
  await mkdir(directory, { recursive: true });
  for (const [index, chunk] of chunks.entries()) {
    progress({ completed: index, total: chunks.length });
    const filename = `${sample ? 'sample' : 'narration'}-${hash(`${voiceId}:multilingual-v2:0.65:0.8:0.92:${chunk}`).slice(0, 20)}.mp3`;
    const path = join(directory, filename);
    let exists = true; try { await access(path); } catch { exists = false; }
    if (!exists) {
      const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({ text: chunk, model_id: 'eleven_multilingual_v2', previous_request_ids: requestIds.slice(-3), previous_text: chunks[index - 1]?.slice(-1000), next_text: chunks[index + 1]?.slice(0, 1000), voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.92 } }),
      });
      if (!response.ok) throw fail(`ElevenLabs returned ${response.status}. Check your key, voice access and credits. Completed parts are cached; retry to continue.`, 502);
      if (!(response.headers.get('content-type') || '').includes('audio/')) throw fail('ElevenLabs did not return audio.', 502);
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length) throw fail('ElevenLabs returned an empty recording.', 502);
      await writeFile(path, data);
      if (response.headers.get('request-id')) requestIds.push(response.headers.get('request-id'));
    }
    tracks.push({ title: sample ? 'Voice preview' : `Part ${index + 1}`, src: `../../assets/essays/${slug}/${filename}` });
  }
  progress({ completed: chunks.length, total: chunks.length });
  return { narrator: narrator || 'ElevenLabs narrator', voice_id: voiceId, ai_generated: true, source_hash: narrationHash(document), tracks };
}
