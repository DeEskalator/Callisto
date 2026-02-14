/** Entry point of the voice agent container. */
import { createServer } from 'node:http';
import { Logger } from '@aws-lambda-powertools/logger';
import {
  CallRepository,
  ConfigRepository,
  createDocumentClient,
  SlotRepository,
} from '@callisto/data';
import { KeywordEmergencyMonitor } from './emergency';
import { NOVA_SONIC_DEFAULTS, NovaSonicModel } from './nova-sonic-model';
import { attachVoiceServer } from './server';
import { PollySpeechSynthesizer } from './speech';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

const logger = new Logger({ serviceName: 'voice-agent' });
const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');

// The load balancer checks this; everything else on plain HTTP is not for us.
const server = createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 404).end();
});

attachVoiceServer(server, {
  config: new ConfigRepository(doc, planningTable),
  slots: new SlotRepository(doc, planningTable),
  calls: new CallRepository(doc, requireEnv('CALLS_TABLE')),
  model: new NovaSonicModel({
    region: process.env.BEDROCK_REGION ?? NOVA_SONIC_DEFAULTS.region,
    modelId: process.env.NOVA_SONIC_MODEL_ID ?? NOVA_SONIC_DEFAULTS.modelId,
    voiceId: process.env.NOVA_SONIC_VOICE_ID ?? NOVA_SONIC_DEFAULTS.voiceId,
  }),
  speech: new PollySpeechSynthesizer(),
  emergency: new KeywordEmergencyMonitor(),
  ticketSecret: requireEnv('TICKET_SECRET'),
  log: (message, details) => logger.info(message, details ?? {}),
  // Never log what was said, only that something went wrong.
  onError: (message, error) => logger.error(message, { error }),
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => logger.info(`Voice agent listening on port ${port}`));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
