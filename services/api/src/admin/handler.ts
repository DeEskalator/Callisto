import { Logger } from '@aws-lambda-powertools/logger';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  AuditRepository,
  ConfigRepository,
  createDocumentClient,
  SlotRepository,
  UserRepository,
} from '@callisto/data';
import { handle } from '@hono/aws-lambda';
import { requireEnv } from '../lib/app';
import { createAdminApp } from './app';

const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');

/**
 * Where test conversations are held and the secret their tickets are signed with. Both are only
 * set once the voice agent is deployed; until then the test mode reports itself unavailable.
 * The secret is read once per Lambda instance, not per request.
 */
async function voiceSettings() {
  const { VOICE_URL: url, TICKET_SECRET_ARN: secretArn } = process.env;
  if (!url || !secretArn) {
    return undefined;
  }
  const secret = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  return secret.SecretString ? { url, ticketSecret: secret.SecretString } : undefined;
}

const app = createAdminApp({
  config: new ConfigRepository(doc, planningTable),
  users: new UserRepository(doc, planningTable),
  slots: new SlotRepository(doc, planningTable),
  audit: new AuditRepository(doc, planningTable),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
  logger: new Logger(),
  voice: await voiceSettings(),
});

export const handler = handle(app);
