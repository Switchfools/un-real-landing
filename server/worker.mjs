import { runtime } from './runtime.mjs';

export async function handler(event) {
  const { config, workspace, jobs, narration, releases } = await runtime();
  const identity = { owner: `github:${config.ownerGithubId}`, clientId: null, permissions: ['read', 'propose'] };
  if (!event.Records) {
    // Durable outbox sweep covers a crash between committing a job and sending it to SQS.
    await jobs.dispatch(identity); return;
  }
  const batchItemFailures = [];
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      if (message.owner !== identity.owner) throw new Error('Owner mismatch');
      await jobs.run(identity, message.id, job => job.kind === 'narration' ? narration.part(identity, job) : releases.publishJob(identity, job.input));
      await jobs.dispatch(identity);
    } catch { console.error(JSON.stringify({ event: 'worker_delivery_failed', messageId: record.messageId })); batchItemFailures.push({ itemIdentifier: record.messageId }); }
  }
  return { batchItemFailures };
}
