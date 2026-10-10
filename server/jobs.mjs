import { randomUUID } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { requireHuman, requireValue, now } from './errors.mjs';

export class Jobs {
  constructor(workspace, { queueUrl, queue = new SQSClient({}), owner } = {}) { Object.assign(this, { workspace, queueUrl, queue, owner }); }
  async insert(tx, kind, input, id = randomUUID()) {
    const job = { id, kind, input, state: 'queued', createdAt: now(), dispatchedAt: null, attempt: 0 };
    await tx.insert('job', id, job); return job;
  }
  async dispatch(identity) {
    if (!this.queueUrl) return;
    const jobs = await this.workspace.tx(identity, tx => tx.list('job'));
    for (const job of jobs.filter(item => item.state === 'queued' && !item.dispatchedAt)) {
      await this.queue.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify({ owner: identity.owner, id: job.id }), MessageGroupId: identity.owner.replaceAll(':', '-'), MessageDeduplicationId: `${job.id}:${job.attempt}:${job.completed || 0}` }));
      await this.workspace.tx(identity, async tx => { const latest = await tx.get('job', job.id); if (latest.state === 'queued' && latest.attempt === job.attempt && (latest.completed || 0) === (job.completed || 0)) await tx.put('job', job.id, { ...latest, dispatchedAt: now() }); });
    }
  }
  async run(identity, id, execute) {
    const leased = await this.workspace.tx(identity, async tx => {
      const job = await tx.get('job', id);
      if (['complete', 'failed', 'uncertain'].includes(job.state)) return null;
      if (job.state === 'running' && Date.parse(job.leaseUntil) > Date.now()) return null;
      if (job.providerPending) { await tx.put('job', id, { ...job, state: 'uncertain', error: 'The provider may have generated this part before the worker stopped. Review and explicitly retry if needed.' }); console.error(JSON.stringify({ event: 'job_failed', kind: job.kind, state: 'uncertain' })); return null; }
      const next = { ...job, state: 'running', leaseUntil: new Date(Date.now() + 360000).toISOString(), lease: randomUUID() }; await tx.put('job', id, next); return next;
    });
    if (!leased) return;
    try {
      const result = await execute(leased);
      await this.workspace.tx(identity, async tx => { const current = await tx.get('job', id); if (current.lease === leased.lease) await tx.put('job', id, result?.continue ? { ...current, state: 'queued', dispatchedAt: null, leaseUntil: null } : { ...current, state: 'complete', result, providerPending: false, completedAt: now() }); });
    } catch (error) {
      await this.workspace.tx(identity, async tx => {
        const current = await tx.get('job', id); if (current.lease !== leased.lease) return;
        const state = current.providerPending ? 'uncertain' : 'failed';
        console.error(JSON.stringify({ event: 'job_failed', kind: current.kind, state }));
        await tx.put('job', id, { ...current, state, error: error.status ? error.message : 'The job failed. Review its status before retrying.' });
        if (current.kind === 'publish') { const release = await tx.get('release', current.input.releaseId); await tx.put('release', release.id, { ...release, state: 'failed', error: error.status ? error.message : 'Publication did not complete. Check or retry the release.' }); }
      });
    }
  }
  async retry(identity, id) {
    requireHuman(identity);
    await this.workspace.tx(identity, async tx => {
      const job = await tx.get('job', id); requireValue(['failed', 'uncertain'].includes(job.state), 'Only a failed or uncertain job can be retried.', 409);
      await tx.put('job', id, { ...job, state: 'queued', dispatchedAt: null, providerPending: false, error: null, attempt: job.attempt + 1 });
    });
    await this.dispatch(identity); return { id, state: 'queued' };
  }
}
