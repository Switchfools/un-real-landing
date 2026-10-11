import { readFile } from 'node:fs/promises';
import { Secrets } from '../server/secrets.mjs';
import { listVoices } from './voices.mjs';

if (!process.argv.includes('--from-env')) throw new Error('Use --from-env to copy only ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID into the private hosted Studio secret.');
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
if (!apiKey) throw new Error('Set ELEVENLABS_API_KEY in .env or .env.local first.');
const outputs = JSON.parse(await readFile('.local/essay-studio/aws-outputs.json', 'utf8')).UnrealEssayStudio;
if (!/^arn:aws:secretsmanager:eu-central-1:885072868436:secret:unreal\/essay-studio\/elevenlabs-/.test(outputs.AudioSecretArn)) throw new Error('Unexpected Studio secret; check the stack outputs.');
const voices = await listVoices(apiKey);
const secrets = new Secrets({ audioSecretArn: outputs.AudioSecretArn });
await secrets.setAudio({ apiKey, voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() });
console.log(`ElevenLabs configured in the hosted Studio's private secret. Voice-list access verified (${voices.length} voices). No narration generated.`);
