import { hash, narrationText, narrationHash } from '../scripts/essays.mjs';
import { splitNarration } from '../scripts/narration.mjs';
import { checkRevision } from './workspace.mjs';
import { requireHuman, requireValue, fail } from './errors.mjs';

export class Narration {
  constructor(workspace, media, jobs, secrets, fetcher = fetch) { Object.assign(this, { workspace, media, jobs, secrets, fetch: fetcher }); }
  async start(identity, slug, input) {
    requireHuman(identity);
    const settings = await this.secrets.getAudio(); requireValue(settings.apiKey, 'Connect ElevenLabs first.');
    const voiceId = input.voiceId || settings.voiceId || 'nPczCjzI2devNBz1zQrb';
    requireValue(/^[a-zA-Z0-9_-]{5,100}$/.test(voiceId), 'Choose a valid voice ID.');
    return this.workspace.tx(identity, tx => this.workspace.receipt(tx, `narration:${slug}`, input, async () => {
      const doc = await tx.get('essay', slug); checkRevision(doc, input);
      requireValue(!(await tx.list('job')).some(job => job.kind === 'narration' && job.input.slug === slug && ['queued', 'running'].includes(job.state)), 'Narration is already running for this essay.', 409);
      const full = narrationText(doc); let text = full;
      if (input.sample) { const excerpt = full.slice(0, 600), end = Math.max(excerpt.lastIndexOf('.'), excerpt.lastIndexOf('!'), excerpt.lastIndexOf('?')); text = excerpt.slice(0, end > 120 ? end + 1 : excerpt.length); }
      requireValue(input.sample || doc.metadata.summary?.trim() && doc.body.trim(), 'Write the summary and essay before generating narration.');
      const chunks = splitNarration(text);
      requireValue(chunks.length <= 100, 'This narration is too long. Shorten the essay or attach a recording.');
      const job = await this.jobs.insert(tx, 'narration', { slug, sample: Boolean(input.sample), chunks, voiceId, narrator: String(input.narrator || 'ElevenLabs narrator').slice(0, 200), sourceHash: narrationHash(doc) });
      return { id: job.id, state: 'running' };
    }));
  }
  async status(identity, slug) {
    return this.workspace.tx(identity, async tx => {
      const jobs = (await tx.list('job')).filter(job => job.kind === 'narration' && job.input.slug === slug && !job.acknowledged);
      const job = jobs.at(-1); if (!job) return { state: 'idle' };
      return { id: job.id, state: ['queued', 'running'].includes(job.state) ? 'running' : ['failed', 'uncertain'].includes(job.state) ? 'error' : job.state,
        uncertain: job.state === 'uncertain', error: job.error, completed: job.completed || 0, total: job.input.chunks.length, sample: job.input.sample, audio: job.result };
    });
  }
  async ack(identity, slug) { requireHuman(identity); return this.workspace.tx(identity, async tx => { for (const job of await tx.list('job')) if (job.kind === 'narration' && job.input.slug === slug && job.state === 'complete') await tx.put('job', job.id, { ...job, acknowledged: true }); return { ok: true }; }); }
  async part(identity, job) {
    const index = job.completed || 0, { chunks, voiceId, slug, sample, sourceHash, narrator } = job.input;
    // A worker can stop after persisting the last part but before closing its job.
    if (index >= chunks.length) return { narrator, voice_id: voiceId, ai_generated: true, source_hash: sourceHash, tracks: job.tracks };
    const chunk = chunks[index];
    const filename = `${sample ? 'sample' : 'narration'}-${hash(JSON.stringify({ voiceId, model: 'eleven_multilingual_v2', settings: [0.65, 0.8, 0.15, 0.92], chunk, previous: chunks[index - 1], next: chunks[index + 1] })).slice(0, 24)}.mp3`;
    let asset = await this.workspace.tx(identity, tx => tx.get('asset', `${slug}/${filename}`, false));
    let providerRequestId = null;
    if (!asset) {
      const settings = await this.secrets.getAudio(); requireValue(settings.apiKey, 'Connect ElevenLabs before retrying.');
      await this.workspace.tx(identity, async tx => { const current = await tx.get('job', job.id); requireValue(current.lease === job.lease, 'The worker lease changed.', 409); await tx.put('job', job.id, { ...current, providerPending: true }); });
      const response = await this.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': settings.apiKey, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
        body: JSON.stringify({ text: chunk, model_id: 'eleven_multilingual_v2', previous_request_ids: (job.providerIds || []).slice(-3), previous_text: chunks[index - 1]?.slice(-1000), next_text: chunks[index + 1]?.slice(0, 1000), voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.92 } }),
      });
      if (!response.ok) {
        // Definite client rejection can be retried; a server failure may have incurred charges.
        if (response.status < 500) await this.workspace.tx(identity, async tx => { const current = await tx.get('job', job.id); await tx.put('job', job.id, { ...current, providerPending: false }); });
        throw fail(`ElevenLabs returned ${response.status}. Check voice access and credits before retrying.`, 502);
      }
      requireValue(response.headers.get('content-type')?.includes('audio/'), 'ElevenLabs returned an unexpected response.', 502);
      const bytes = Buffer.from(await response.arrayBuffer()); requireValue(bytes.length && bytes.length <= 60_000_000, 'The generated recording was empty or too large.', 502);
      asset = await this.media.storeGenerated(identity, slug, filename, bytes); providerRequestId = response.headers.get('request-id');
    }
    const tracks = [...(job.tracks || []), { title: sample ? 'Voice preview' : `Part ${index + 1}`, src: `../../assets/essays/${asset.id}` }];
    const audio = { narrator, voice_id: voiceId, ai_generated: true, source_hash: sourceHash, tracks };
    await this.workspace.tx(identity, async tx => {
      const current = await tx.get('job', job.id); requireValue(current.lease === job.lease, 'The worker lease changed.', 409);
      await tx.put('job', job.id, { ...current, tracks, completed: index + 1, providerPending: false, providerIds: [...(job.providerIds || []), ...(providerRequestId ? [providerRequestId] : [])] });
      if (sample && index + 1 === chunks.length) await tx.put('settings', `narration-preview:${slug}`, audio);
    });
    return index + 1 < chunks.length ? { continue: true } : audio;
  }
}
