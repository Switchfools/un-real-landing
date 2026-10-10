import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { requireValue } from './errors.mjs';
export class Secrets {
  constructor({ audioSecretArn, runtimeSecretArn, publisherSecretArn }, client = new SecretsManagerClient({})) { Object.assign(this, { audioSecretArn, runtimeSecretArn, publisherSecretArn, client }); }
  async get(arn) { const value = await this.client.send(new GetSecretValueCommand({ SecretId: arn })); return JSON.parse(value.SecretString || '{}'); }
  getAudio() { return this.get(this.audioSecretArn); }
  async setAudio(input) {
    const current = await this.getAudio();
    requireValue(!input.apiKey || typeof input.apiKey === 'string' && input.apiKey.length < 1000, 'Invalid API key.');
    const next = { apiKey: input.apiKey?.trim() || current.apiKey || '', voiceId: String(input.voiceId || current.voiceId || 'nPczCjzI2devNBz1zQrb').slice(0, 100) };
    await this.client.send(new PutSecretValueCommand({ SecretId: this.audioSecretArn, SecretString: JSON.stringify(next) }));
    return { connected: Boolean(next.apiKey), voiceId: next.voiceId };
  }
}
