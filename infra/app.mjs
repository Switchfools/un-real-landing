import { App } from 'aws-cdk-lib';
import { EssayStudioStack } from './stack.mjs';
const app = new App();
new EssayStudioStack(app, 'UnrealEssayStudio', { env: { account: '885072868436', region: 'eu-central-1' } });
