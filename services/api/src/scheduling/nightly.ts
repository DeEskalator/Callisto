import { Logger } from '@aws-lambda-powertools/logger';
import { ConfigRepository, createDocumentClient, SlotRepository } from '@callisto/data';
import { requireEnv } from '../lib/app';
import { reconcileSlots } from './reconcile';

const logger = new Logger();
const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');
const config = new ConfigRepository(doc, planningTable);
const slots = new SlotRepository(doc, planningTable);

/**
 * Runs once a night. The booking horizon moves forward by a day every day, so the slots of the
 * newly reachable day have to be created; anything else that drifted is corrected along the way.
 */
export const handler = async (): Promise<void> => {
  const practiceId = requireEnv('PRACTICE_ID');
  const practice = await config.load(practiceId);
  if (!practice) {
    logger.warn('Practice is not set up yet, nothing to do', { practiceId });
    return;
  }
  const changes = await reconcileSlots(practice, slots);
  logger.info('Slots reconciled', { practiceId, ...changes });
};
