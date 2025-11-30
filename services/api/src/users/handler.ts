import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
  AuditRepository,
  ConfigRepository,
  createDocumentClient,
  UserRepository,
} from '@callisto/data';
import { handle } from 'hono/aws-lambda';
import { requireEnv } from '../lib/app';
import { createUsersApp } from './app';
import { CognitoUserDirectory } from './directory';

const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');

const app = createUsersApp({
  config: new ConfigRepository(doc, planningTable),
  users: new UserRepository(doc, planningTable),
  audit: new AuditRepository(doc, planningTable),
  directory: new CognitoUserDirectory(
    new CognitoIdentityProviderClient({}),
    requireEnv('USER_POOL_ID'),
  ),
  allowedOrigins: requireEnv('ALLOWED_ORIGINS').split(','),
  logger: new Logger(),
});

export const handler = handle(app);
