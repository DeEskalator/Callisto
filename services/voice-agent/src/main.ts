/** Entry point of the voice agent container. */
import { createServer } from 'node:http';
import { Logger } from '@aws-lambda-powertools/logger';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  CallRepository,
  ConfigRepository,
  createDocumentClient,
  expiryAfterDays,
  SlotRepository,
} from '@callisto/data';
import { KeywordEmergencyMonitor } from './emergency';
import { NOVA_SONIC_DEFAULTS, NovaSonicModel } from './nova-sonic-model';
import { attachVoiceServer } from './server';
import type { SessionDeps } from './session';
import { PollySpeechSynthesizer } from './speech';
import { detectPublicAddress, registerWithVoiceConnector } from './telephony/public-address';
import { SipServer } from './telephony/sip-server';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

const logger = new Logger({ serviceName: 'voice-agent' });
const log = (message: string, details?: Record<string, unknown>) =>
  logger.info(message, details ?? {});

// The same secret the API signs test tickets with.
const secret = await new SecretsManagerClient({}).send(
  new GetSecretValueCommand({ SecretId: requireEnv('TICKET_SECRET_ARN') }),
);
const ticketSecret = secret.SecretString;
if (!ticketSecret) {
  throw new Error('The ticket secret is empty');
}
const doc = createDocumentClient();
const planningTable = requireEnv('PLANNING_TABLE');
const calls = new CallRepository(doc, requireEnv('CALLS_TABLE'));

const sessionDeps: SessionDeps = {
  config: new ConfigRepository(doc, planningTable),
  slots: new SlotRepository(doc, planningTable),
  calls,
  model: new NovaSonicModel({
    region: process.env.BEDROCK_REGION ?? NOVA_SONIC_DEFAULTS.region,
    modelId: process.env.NOVA_SONIC_MODEL_ID ?? NOVA_SONIC_DEFAULTS.modelId,
    voiceId: process.env.NOVA_SONIC_VOICE_ID ?? NOVA_SONIC_DEFAULTS.voiceId,
  }),
  speech: new PollySpeechSynthesizer(),
  emergency: new KeywordEmergencyMonitor(),
  // Never log what was said, only that something went wrong.
  onError: (message, error) => logger.error(message, { error }),
};

// ── Test calls from the web app (WebSocket behind the load balancer) ────────────

// The load balancer checks this; everything else on plain HTTP is not for us.
const server = createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 404).end();
});
attachVoiceServer(server, { ...sessionDeps, ticketSecret, log });
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => log(`Voice agent listening on port ${port}`));

// ── The phone line (SIP from the Voice Connector), when telephony is configured ─

let phone: SipServer | undefined;
if (process.env.SIP_PORT) {
  const [min, max] = requireEnv('RTP_PORTS').split('-').map(Number);
  const publicAddress = process.env.SIP_PUBLIC_ADDRESS ?? (await detectPublicAddress());
  phone = new SipServer({
    sipPort: Number(process.env.SIP_PORT),
    rtpPorts: { min: min ?? 20000, max: max ?? 20199 },
    publicAddress,
    practiceId: requireEnv('PRACTICE_ID'),
    session: sessionDeps,
    // The SIP media application looks for this mark when the agent hangs up (one hour is far
    // more than the few seconds that takes).
    onTransfer: (transactionId) => calls.markTransfer(transactionId, expiryAfterDays(1 / 24)),
    log,
  });
  await phone.start();
  log('Phone line ready', { publicAddress, sipPort: process.env.SIP_PORT });
  if (process.env.VOICE_CONNECTOR_ID) {
    await registerWithVoiceConnector({
      voiceConnectorId: process.env.VOICE_CONNECTOR_ID,
      region: requireEnv('VOICE_CONNECTOR_REGION'),
      address: publicAddress,
      port: Number(process.env.SIP_PORT),
    });
    log('The Voice Connector now sends calls to this container', { publicAddress });
  }
}

process.on('SIGTERM', () => {
  // New calls go to the next container; running ones get the deregistration delay to finish.
  void phone?.close();
  server.close(() => process.exit(0));
});
