/**
 * Local development server: the same Hono apps that run on Lambda, on in-memory stores.
 *
 * It needs no AWS account. There is no sign-in; the caller is whoever the `X-Dev-User` header
 * names (default: the demo administrator). This file is never part of a Lambda bundle.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { Logger } from '@aws-lambda-powertools/logger';
import { type AppointmentCategory, addDays, type SlotTemplate, toZoned } from '@callisto/domain';
import { createAdminApp } from '../admin/app';
import { API_ROUTES } from '../routes';
import { reconcileSlots } from '../scheduling/reconcile';
import { createUsersApp } from '../users/app';
import {
  MemoryAuditStore,
  MemoryConfigStore,
  MemorySlotStore,
  MemoryUserDirectory,
  MemoryUserStore,
  signedInAs,
} from './memory-stores';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const PRACTICE_ID = 'main';
const DEFAULT_USER = 'dev-admin';

const logger = new Logger({ serviceName: 'dev-server' });
const config = MemoryConfigStore.withPractice(PRACTICE_ID, 'Hausarztpraxis am Markt', 'NW');
const users = new MemoryUserStore();
const slots = new MemorySlotStore();
const audit = new MemoryAuditStore();
const directory = new MemoryUserDirectory();

async function seed(): Promise<void> {
  const today = toZoned(new Date(), 'Europe/Berlin').date;
  const createdAt = new Date().toISOString();
  await users.put({
    id: DEFAULT_USER,
    practiceId: PRACTICE_ID,
    email: 'leitung@praxis.example',
    name: 'Praxisleitung (Demo)',
    roleId: 'admin',
    status: 'active',
    createdAt,
  });
  await users.put({
    id: 'dev-staff',
    practiceId: PRACTICE_ID,
    email: 'empfang@praxis.example',
    name: 'Empfang (Demo)',
    roleId: 'staff',
    status: 'active',
    createdAt,
  });

  const categories: AppointmentCategory[] = [
    {
      id: 'acute',
      name: 'Akutsprechstunde',
      description: 'Akute Beschwerden, die am selben oder nächsten Tag angesehen werden sollen.',
      durationMinutes: 10,
      color: '#c2410c',
      active: true,
    },
    {
      id: 'checkup',
      name: 'Vorsorge',
      description: 'Check-up, Hautkrebsscreening und andere Vorsorgeuntersuchungen.',
      durationMinutes: 30,
      patientHint: 'Bitte bringen Sie Ihren Impfpass mit.',
      color: '#1d4ed8',
      active: true,
    },
    {
      id: 'blood',
      name: 'Blutabnahme',
      description: 'Blutabnahme und Laborkontrollen.',
      durationMinutes: 10,
      patientHint: 'Bitte kommen Sie nüchtern.',
      color: '#7e22ce',
      active: true,
    },
  ];
  const everyWeekday = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
  const templates: SlotTemplate[] = [
    {
      id: 'acute-morning',
      name: 'Akut vormittags',
      categoryId: 'acute',
      weekdays: [...everyWeekday],
      from: '08:00',
      to: '09:00',
      capacity: 1,
      validFrom: today,
      active: true,
    },
    {
      id: 'blood-early',
      name: 'Labor früh',
      categoryId: 'blood',
      weekdays: ['mon', 'wed', 'fri'],
      from: '07:30',
      to: '08:30',
      capacity: 2,
      validFrom: today,
      active: true,
    },
    {
      id: 'checkup-afternoon',
      name: 'Vorsorge nachmittags',
      categoryId: 'checkup',
      weekdays: ['tue', 'thu'],
      from: '15:00',
      to: '17:00',
      capacity: 1,
      validFrom: today,
      active: true,
    },
  ];
  for (const category of categories) {
    await config.putItem(PRACTICE_ID, 'categories', category);
  }
  for (const template of templates) {
    await config.putItem(PRACTICE_ID, 'templates', template);
  }
  await config.putItem(PRACTICE_ID, 'closures', {
    id: 'bridge-day',
    title: 'Brückentag',
    from: addDays(today, 20),
    to: addDays(today, 20),
    allDay: true,
  });

  const practice = await config.load(PRACTICE_ID);
  if (practice) {
    await reconcileSlots(practice, slots);
  }
}

const shared = { config, users, audit, allowedOrigins: [WEB_ORIGIN], logger };
const apps = {
  admin: createAdminApp({ ...shared, slots }),
  users: createUsersApp({ ...shared, directory }),
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
    const functionName = (API_ROUTES as Record<string, keyof typeof apps>)[segment] ?? 'admin';
    const header = incoming.headers['x-dev-user'];
    const userId = typeof header === 'string' && header ? header : DEFAULT_USER;

    const response = await apps[functionName].fetch(
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

await seed();
server.listen(PORT, () => {
  logger.info(`Callisto API (development, in-memory) on http://localhost:${PORT}/v1`);
});
