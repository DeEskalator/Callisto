import { Logger } from '@aws-lambda-powertools/logger';
import {
  AuditRepository,
  ConfigRepository,
  createDocumentClient,
  SlotRepository,
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
  slots: new SlotRepository(doc, planningTable),
  audit: new AuditRepository(doc, planningTable),
  allowedOrigins: requireEnv('ALLOWED_ORIGINS').split(','),
  logger: new Logger(),
  // Set once the voice agent is deployed; until then the test mode reports itself unavailable.
  voice:
    process.env.VOICE_URL && process.env.TICKET_SECRET
      ? { url: process.env.VOICE_URL, ticketSecret: process.env.TICKET_SECRET }
      : undefined,
});

export const handler = handle(app);
