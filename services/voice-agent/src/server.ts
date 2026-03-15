import type { IncomingMessage, Server } from 'node:http';
import { verifyTestTicket } from '@callisto/data';
import { type WebSocket, WebSocketServer } from 'ws';
import { type CallerLink, ConversationSession, type SessionDeps } from './session';

export interface VoiceServerDeps extends SessionDeps {
  /** Secret the API signs test tickets with. */
  ticketSecret: string;
  log: (message: string, details?: Record<string, unknown>) => void;
}

/** Path of the WebSocket endpoint for test conversations from the web app. */
export const VOICE_PATH = '/voice';
const HEARTBEAT_MS = 25_000;

/*
 * Protocol of a test conversation.
 *
 * The browser connects to `/voice?ticket=…&mode=text|voice` with a ticket from the API.
 *   browser → agent   text frame   {"type":"text","text":"…"} | {"type":"hangup"}
 *                     binary frame speech, 16 kHz 16 bit mono PCM
 *   agent → browser   text frame   {"type":"started","callId":"…"}
 *                                  {"type":"transcript","role":"caller"|"assistant","text":"…"}
 *                                  {"type":"clear"}            drop audio not yet played
 *                                  {"type":"ended","reason":"…"}
 *                     binary frame speech, same format
 */

function linkTo(socket: WebSocket): CallerLink {
  const send = (message: Record<string, unknown>) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };
  return {
    transcript: (role, text) => send({ type: 'transcript', role, text }),
    audio: (pcm) => socket.readyState === socket.OPEN && socket.send(pcm, { binary: true }),
    clearAudio: () => send({ type: 'clear' }),
    ended: (reason) => {
      send({ type: 'ended', reason });
      socket.close(1000);
    },
  };
}

async function converse(socket: WebSocket, request: IncomingMessage, deps: VoiceServerDeps) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const ticket = verifyTestTicket(url.searchParams.get('ticket') ?? '', deps.ticketSecret);
  if (!ticket) {
    socket.close(4401, 'invalid ticket');
    return;
  }
  const voice = url.searchParams.get('mode') === 'voice';

  // Frames can arrive while the session is still being set up; they wait here.
  const early: Array<() => void> = [];
  let session: ConversationSession | undefined;
  const whenReady = (action: (ready: ConversationSession) => void) =>
    session ? action(session) : early.push(() => session && action(session));

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      whenReady((ready) => ready.receiveAudio(data as Buffer));
      return;
    }
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'text' && typeof message.text === 'string') {
        whenReady((ready) => ready.receiveText(message.text.slice(0, 2000)));
      } else if (message.type === 'hangup') {
        whenReady((ready) => void ready.hangUp());
      }
    } catch {
      // Not JSON: ignore the frame.
    }
  });
  socket.on('close', () => whenReady((ready) => void ready.hangUp()));

  try {
    session = await ConversationSession.start(
      { practiceId: ticket.practiceId, channel: voice ? 'test_voice' : 'test_text' },
      deps,
      linkTo(socket),
    );
    socket.send(JSON.stringify({ type: 'started', callId: session.callId }));
    for (const action of early) {
      action();
    }
  } catch (error) {
    deps.log('A test conversation could not be started', { error: String(error) });
    socket.close(1011, 'could not start');
  }
}

/** Serves test conversations on an existing HTTP server. */
export function attachVoiceServer(server: Server, deps: VoiceServerDeps): WebSocketServer {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  // Proxies on the way (CloudFront, the load balancer) close connections that stay silent too
  // long; in a typed conversation nothing may flow for minutes. A ping keeps them open.
  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  sockets.on('close', () => clearInterval(heartbeat));
  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith(VOICE_PATH)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      void converse(webSocket, request, deps);
    });
  });
  return sockets;
}
