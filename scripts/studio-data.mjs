// Operator-only import/backup tool. Run with the authorized AWS credential wrapper.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { postgresDatabase } from '../server/database.mjs';
import { Workspace } from '../server/workspace.mjs';
import { S3Media, MediaService } from '../server/media.mjs';
import { snapshotFiles, importFiles, backupWorkspace, restoreWorkspace, exportOriginalFiles } from '../server/migration.mjs';
import { hash } from './essays.mjs';

const config = JSON.parse(await readFile('.local/essay-studio/runtime.json', 'utf8'));
const outputs = JSON.parse(await readFile('.local/essay-studio/aws-outputs.json', 'utf8')).UnrealEssayStudio;
const command = process.argv[2], db = postgresDatabase(config.databaseUrl), workspace = new Workspace(db, config);
const identity = { owner: `github:${config.ownerGithubId}`, clientId: null }, s3 = new S3Client({ region: 'eu-central-1' });
const media = new MediaService(workspace, new S3Media(outputs.MediaBucket, config.origin, s3));
const backup = async (bytes, id) => {
  await mkdir('.local/essay-studio/backups', { recursive: true });
  await writeFile(`.local/essay-studio/backups/${id}.json.gz`, bytes, { mode: 0o600 });
  const key = `${identity.owner}/${id}.json.gz`;
  const result = await s3.send(new PutObjectCommand({ Bucket: outputs.BackupBucket, Key: key, Body: bytes, ContentType: 'application/gzip', ChecksumSHA256: Buffer.from(hash(bytes), 'hex').toString('base64') }));
  const saved = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: outputs.BackupBucket, Key: key, VersionId: result.VersionId }))).Body.transformToByteArray());
  if (hash(bytes) !== hash(saved)) throw new Error('Remote backup verification failed');
  return { bucket: outputs.BackupBucket, key, versionId: result.VersionId, sha256: hash(saved) };
};
try {
  if (command === 'diagnose') {
    const rows = await workspace.tx(identity, tx => tx.all());
    console.log(JSON.stringify(rows.map(row => ({ kind: row.kind, id: row.id, valueType: typeof row.data, keys: typeof row.data === 'object' ? Object.keys(row.data) : [] })), null, 2));
  } else if (command === 'probe') {
    const rollback = new Error('probe-rollback'), id = randomUUID(), value = { text: 'Unicode: simbiosis — coexistence', nested: { count: 2 }, lines: ['one', 'two'] };
    try { await workspace.tx(identity, async tx => { await tx.insert('probe', id, value); if (JSON.stringify(await tx.get('probe', id)) !== JSON.stringify(value)) {
      const stored = await tx.get('probe', id); if (stored.text !== value.text || stored.nested.count !== 2 || stored.lines.join() !== value.lines.join()) throw new Error('Database round-trip differs');
    } throw rollback; }); } catch (error) { if (error !== rollback) throw error; }
    if (await workspace.tx(identity, tx => tx.get('probe', id, false))) throw new Error('Probe rollback failed');
    console.log('Live Postgres JSON round-trip and transaction rollback passed; no test records retained.');
  } else if (command === 'import') {
    const snapshot = await snapshotFiles(resolve(process.argv[3] || 'content'));
    const result = await importFiles(workspace, identity, snapshot, media, backup);
    await writeFile('.local/essay-studio/migration-verified.json', JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'backup') {
    console.log(JSON.stringify(await backup(await backupWorkspace(workspace, identity, media), `workspace-${Date.now()}`), null, 2));
  } else if (command === 'export-originals') {
    if (!process.argv[3]) throw new Error('Provide a new export directory');
    await exportOriginalFiles(workspace, identity, media, resolve(process.argv[3])); console.log('Original files exported and hashes verified.');
  } else if (command === 'restore') {
    if (!process.argv[3]) throw new Error('Provide a downloaded workspace backup. Restoration requires an empty database.');
    console.log(await restoreWorkspace(workspace, identity, media, await readFile(process.argv[3])));
  } else if (command === 'activate') {
    const verified = JSON.parse(await readFile('.local/essay-studio/migration-verified.json', 'utf8'));
    if (!verified.verified) throw new Error('Verify the migration before activation');
    await new SecretsManagerClient({ region: 'eu-central-1' }).send(new PutSecretValueCommand({ SecretId: outputs.RuntimeSecretArn, SecretString: JSON.stringify(config) }));
    console.log('Verified private workspace activated. Runtime credentials saved in Secrets Manager.');
  } else if (command === 'publisher') {
    const publisher = JSON.parse(await readFile('.local/essay-studio/github-publisher.json', 'utf8'));
    if (!publisher.appId || !publisher.privateKey || !publisher.installationId) throw new Error('Finish the publishing app installation first');
    await new SecretsManagerClient({ region: 'eu-central-1' }).send(new PutSecretValueCommand({ SecretId: outputs.PublisherSecretArn, SecretString: JSON.stringify(publisher) }));
    console.log('Repository-scoped publishing credentials saved in Secrets Manager.');
  } else if (command === 'audio-from-local') {
    let values = {};
    for (const path of ['.env', '.env.local']) { try { values = { ...values, ...parseEnv(await readFile(path, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    if (!values.ELEVENLABS_API_KEY) throw new Error('No local ElevenLabs key found; connect it in the hosted Studio instead');
    await new SecretsManagerClient({ region: 'eu-central-1' }).send(new PutSecretValueCommand({ SecretId: outputs.AudioSecretArn, SecretString: JSON.stringify({ apiKey: values.ELEVENLABS_API_KEY, voiceId: values.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb' }) }));
    console.log('Existing ElevenLabs settings saved in Secrets Manager. No narration was generated.');
  } else throw new Error('Usage: node scripts/studio-data.mjs import|backup|export-originals|restore|activate [directory-or-backup]');
} catch (error) {
  // Database/provider diagnostics may contain private content: retain locally only.
  await writeFile('.local/essay-studio/data-error.log', String(error.stack), { mode: 0o600 });
  console.error('Operation failed; private diagnostic is in .local/essay-studio/data-error.log.'); process.exitCode = 1;
} finally { await db.close(); }
