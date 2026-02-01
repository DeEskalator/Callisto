/**
 * Local development server: the same Hono apps that run on Lambda and the voice agent, in one
 * process on in-memory stores with invented data.
 *
 * It needs no AWS account. There is no sign-in; the caller is whoever the `X-Dev-User` header
 * names (default: the demo administrator). The assistant is played by a scripted stand-in
 * unless `CALLISTO_MODEL=nova` is set, in which case Nova Sonic on Bedrock is used with the
 * AWS credentials of the shell. This file is never part of a Lambda bundle.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { Logger } from '@aws-lambda-powertools/logger';
import {
  MemoryAuditStore,
  MemoryCallStore,
  MemoryConfigStore,
  MemorySlotStore,
  MemoryUserStore,
} from '@callisto/data/memory';
import {
  attachVoiceServer,
  KeywordEmergencyMonitor,
  NovaSonicModel,
  PollySpeechSynthesizer,
  ScriptedModel,
  VOICE_PATH,
} from '@callisto/voice-agent';
import { createAdminApp } from '../admin/app';
import { createCallsApp } from '../calls/app';
import { API_ROUTES, type ApiFunctionName } from '../routes';
import { createUsersApp } from '../users/app';
import { DEMO_ADMIN_ID, DEMO_PRACTICE_ID, seedDemoData } from './demo-data';
import { MemoryUserDirectory, signedInAs } from './memory-directory';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const TICKET_SECRET = 'local-development-only';
const useNova = process.env.CALLISTO_MODEL === 'nova';

const logger = new Logger({ serviceName: 'dev-server' });
const config = MemoryConfigStore.withPractice(DEMO_PRACTICE_ID, 'Hausarztpraxis am Markt', 'NW');
const users = new MemoryUserStore();
const slots = new MemorySlotStore();
const calls = new MemoryCallStore();
const audit = new MemoryAuditStore();

const shared = { config, users, audit, allowedOrigins: [WEB_ORIGIN], logger };
const adminApp = createAdminApp({
  ...shared,
  slots,
  voice: { url: `ws://localhost:${PORT}${VOICE_PATH}`, ticketSecret: TICKET_SECRET },
});
const callsApp = createCallsApp({ ...shared, slots, calls });
const usersApp = createUsersApp({ ...shared, directory: new MemoryUserDirectory() });

type Identity = ReturnType<typeof signedInAs>;
const apps: Record<
  ApiFunctionName,
  (request: Request, identity: Identity) => Response | Promise<Response>
> = {
  admin: (request, identity) => adminApp.fetch(request, identity),
  calls: (request, identity) => callsApp.fetch(request, identity),
  users: (request, identity) => usersApp.fetch(request, identity),
};

async function toRequest(incoming: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        headers.append(name, item);
      }
    }
  }
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
  const chunks: Buffer[] = [];
  if (hasBody) {
    for await (const chunk of incoming) {
      chunks.push(chunk);
    }
  }
  return new Request(url, {
    method: incoming.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
    // In production API Gateway answers the CORS preflight; here this server does.
    if (incoming.method === 'OPTIONS') {
      outgoing
        .writeHead(204, {
          'Access-Control-Allow-Origin': WEB_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dev-User',
          'Access-Control-Max-Age': '600',
        })
        .end();
      return;
    }

    const segment = url.pathname.split('/')[2] ?? '';
    const routes: Record<string, ApiFunctionName> = API_ROUTES;
    const header = incoming.headers['x-dev-user'];
    const userId = typeof header === 'string' && header ? header : DEMO_ADMIN_ID;

    const response = await apps[routes[segment] ?? 'admin'](
      await toRequest(incoming, url),
      signedInAs(userId),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    logger.error('Request failed', { error });
    outgoing.writeHead(500).end();
  }
});

attachVoiceServer(server, {
  config,
  calls,
  slots,
  model: useNova ? new NovaSonicModel() : new ScriptedModel(),
  emergency: new KeywordEmergencyMonitor(),
  ...(useNova ? { speech: new PollySpeechSynthesizer() } : {}),
  ticketSecret: TICKET_SECRET,
  log: (message, details) => logger.info(message, details ?? {}),
  onError: (message, error) => logger.error(message, { error }),
});

await seedDemoData({ config, users, slots, calls });
server.listen(PORT, () => {
  logger.info(`Callisto API (development, in-memory) on http://localhost:${PORT}/v1`);
  logger.info(`Assistant: ${useNova ? 'Nova Sonic on Bedrock' : 'scripted stand-in'}`);
});
