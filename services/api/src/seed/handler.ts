import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { ConfigRepository, createDocumentClient, UserRepository } from '@callisto/data';
import {
  ADMIN_ROLE_ID,
  BUILTIN_ROLES,
  DEFAULT_OPENING_HOURS,
  DEFAULT_PRESETS,
  defaultPracticeSettings,
  FEDERAL_STATES,
  type FederalState,
} from '@callisto/domain';
import { requireEnv } from '../lib/app';
import { CognitoUserDirectory, UserExistsError } from '../users/directory';

const logger = new Logger();
const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');
const config = new ConfigRepository(doc, planningTable);
const users = new UserRepository(doc, planningTable);
const directory = new CognitoUserDirectory(
  new CognitoIdentityProviderClient({}),
  requireEnv('USER_POOL_ID'),
);

function federalState(): FederalState {
  const value = requireEnv('FEDERAL_STATE');
  if (!(FEDERAL_STATES as readonly string[]).includes(value)) {
    throw new Error(`Unknown federal state ${value}`);
  }
  return value as FederalState;
}

/**
 * Runs after every deployment and brings a fresh environment into a usable state: the practice
 * with default settings, the built-in roles and the first administrator. It only adds what is
 * missing, so running it again never overwrites what the practice has configured since.
 */
export const handler = async (): Promise<void> => {
  const practiceId = requireEnv('PRACTICE_ID');

  const created = await config.createPractice(practiceId, {
    settings: defaultPracticeSettings(requireEnv('PRACTICE_NAME'), federalState()),
    hours: DEFAULT_OPENING_HOURS,
    presets: DEFAULT_PRESETS,
  });
  logger.info(created ? 'Practice created with default settings' : 'Practice already exists');

  // Built-in roles are defined in code; rewriting them keeps the table in step with new permissions.
  for (const role of BUILTIN_ROLES) {
    await config.putItem(practiceId, 'roles', role);
  }

  const existingUsers = await users.listByPractice(practiceId);
  if (existingUsers.length > 0) {
    return;
  }
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const name = requireEnv('ADMIN_NAME');
  let userId: string | undefined;
  try {
    userId = await directory.createUser(email, name);
    logger.info('First administrator invited');
  } catch (error) {
    if (!(error instanceof UserExistsError)) {
      throw error;
    }
    // The account survived an earlier, incomplete run; only its profile is missing.
    userId = await directory.findUserId(email);
  }
  if (!userId) {
    throw new Error('The administrator account exists but could not be looked up');
  }
  await users.put({
    id: userId,
    practiceId,
    email,
    name,
    roleId: ADMIN_ROLE_ID,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
};
