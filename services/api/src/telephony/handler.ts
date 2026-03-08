import { Logger } from '@aws-lambda-powertools/logger';
import { CallRepository, ConfigRepository, createDocumentClient } from '@callisto/data';
import { requireEnv } from '../lib/app';
import { type CallEvent, type CallFlowResponse, handleCallEvent } from './call-flow';

const logger = new Logger();
const doc = createDocumentClient();
const config = new ConfigRepository(doc, requireEnv('PLANNING_TABLE'));
const calls = new CallRepository(doc, requireEnv('CALLS_TABLE'));
const practiceId = requireEnv('PRACTICE_ID');

/** Invoked by the SIP media application for every event of a phone call. */
export const handler = async (event: CallEvent): Promise<CallFlowResponse> => {
  // Event type and sequence only: numbers and ids of callers stay out of the log.
  logger.info('Call event', { type: event.InvocationEventType, sequence: event.Sequence });
  return handleCallEvent(event, {
    voiceConnectorArn: requireEnv('VOICE_CONNECTOR_ARN'),
    phoneNumber: requireEnv('PHONE_NUMBER'),
    // Read on every transfer, so a number changed in the settings applies at once.
    transferNumber: async () => (await config.load(practiceId))?.settings.transferNumber,
    takeTransfer: (transactionId) => calls.takeTransfer(transactionId),
  });
};
