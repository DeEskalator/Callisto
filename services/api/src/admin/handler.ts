import { Logger } from '@aws-lambda-powertools/logger';
import {
  AuditRepository,
  ConfigRepository,
  createDocumentClient,
  UserRepository,
} from '@callisto/data';
import { handle } from 'hono/aws-lambda';
import { requireEnv } from '../lib/app';
import { createAdminApp } from './app';

const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');

const app = createAdminApp({
  config: new ConfigRepository(doc, planningTable),
  users: new UserRepository(doc, planningTable),
  audit: new AuditRepository(doc, planningTable),
  allowedOrigins: requireEnv('ALLOWED_ORIGINS').split(','),
  logger: new Logger(),
});

export const handler = handle(app);
