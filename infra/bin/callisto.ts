import { join } from 'node:path';
import { App, Tags } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';

const app = new App();
const config = loadConfig(join(import.meta.dirname, '..'));
const env = { account: config.account ?? process.env.CDK_DEFAULT_ACCOUNT, region: config.region };
const prefix = `Callisto-${config.stage}`;

const data = new DataStack(app, `${prefix}-Data`, { env, config });
const auth = new AuthStack(app, `${prefix}-Auth`, { env, config });
new ApiStack(app, `${prefix}-Api`, { env, config, data, auth });

Tags.of(app).add('project', 'callisto');
Tags.of(app).add('stage', config.stage);
