import { Secrets } from './secrets.mjs';
import { postgresDatabase } from './database.mjs';
import { Workspace } from './workspace.mjs';
import { authenticator } from './auth.mjs';
import { S3Media, MediaService } from './media.mjs';
import { Jobs } from './jobs.mjs';
import { Narration } from './narration.mjs';
import { GitHubPublisher } from './github.mjs';
import { Releases } from './releases.mjs';
import { createApp } from './app.mjs';

let services;
export async function runtime() {
  if (services) return services;
  const secrets = new Secrets({ runtimeSecretArn: process.env.RUNTIME_SECRET_ARN, audioSecretArn: process.env.AUDIO_SECRET_ARN, publisherSecretArn: process.env.PUBLISHER_SECRET_ARN });
  const config = await secrets.get(secrets.runtimeSecretArn);
  for (const key of ['databaseUrl', 'origin', 'supabaseUrl', 'supabasePublishableKey', 'supabaseSecretKey', 'ownerGithubId']) if (!config[key]) throw new Error('Studio configuration is incomplete');
  const db = postgresDatabase(config.databaseUrl), workspace = new Workspace(db, config);
  const media = new MediaService(workspace, new S3Media(process.env.MEDIA_BUCKET, config.origin));
  const jobs = new Jobs(workspace, { queueUrl: process.env.QUEUE_URL, owner: `github:${config.ownerGithubId}` });
  // Defer publisher configuration until a release is requested, so writing works before app installation.
  const github = {};
  for (const method of ['head', 'source', 'prepareCommit', 'advance', 'deployment']) github[method] = async (...args) => {
    const publisher = await secrets.get(secrets.publisherSecretArn);
    if (!publisher.appId || !publisher.privateKey || !publisher.installationId) throw Object.assign(new Error('Install the Essay Studio publishing app before preparing a release.'), { status: 503 });
    return new GitHubPublisher({ ...publisher, repo: 'Switchfools/un-real-landing' })[method](...args);
  };
  const narration = new Narration(workspace, media, jobs, secrets), releases = new Releases(workspace, github, media, jobs);
  const authenticate = authenticator(config, db);
  const app = createApp({ config, workspace, authenticate, media, jobs, narration, releases, secrets });
  services = { config, workspace, db, media, jobs, narration, releases, secrets, app }; return services;
}
