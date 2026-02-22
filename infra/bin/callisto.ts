import { join } from 'node:path';
import { App, Tags } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { EdgeCertificateStack } from '../lib/edge-certificate-stack';
import { VoiceStack } from '../lib/voice-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();
const config = loadConfig(join(import.meta.dirname, '..'));
const account = config.account ?? process.env.CDK_DEFAULT_ACCOUNT;
const env = { account, region: config.region };
const prefix = `Callisto-${config.stage}`;

const data = new DataStack(app, `${prefix}-Data`, { env, config });
const auth = new AuthStack(app, `${prefix}-Auth`, { env, config });
const voice = config.voice
  ? new VoiceStack(app, `${prefix}-Voice`, { env, config, data })
  : undefined;
const api = new ApiStack(app, `${prefix}-Api`, {
  env,
  config,
  data,
  auth,
  voiceUrl: voice?.voiceUrl,
});

const certificate = config.domain
  ? new EdgeCertificateStack(app, `${prefix}-EdgeCertificate`, {
      env: { account, region: 'us-east-1' },
      crossRegionReferences: true,
      hostedZoneId: config.domain.hostedZoneId,
      zoneName: config.domain.zoneName,
      domainName: config.domain.appHost,
    }).certificate
  : undefined;
new WebStack(app, `${prefix}-Web`, {
  env,
  crossRegionReferences: config.domain !== undefined,
  config,
  auth,
  api,
  assetDir: join(import.meta.dirname, '..', '..', 'apps', 'web', 'dist'),
  certificate,
});

Tags.of(app).add('project', 'callisto');
Tags.of(app).add('stage', config.stage);
