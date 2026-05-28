/**
 * WebSocket Reconnect-Storm Integration Test
 *
 * Boots a real Fastify server (no DB, mocked auth) on a random TCP port and
 * exercises the WS upgrade path with real `ws` client sockets to verify:
 *
 *  - The sliding cooldown keeps the incumbent socket alive across a sustained
 *    storm of shared-clientId reconnects (no 4009 emitted to incumbent).
 *  - Every challenger arriving inside the cooldown receives a 4008 close.
 *  - The WARN "Reconnect within cooldown" is logged exactly ONCE per
 *    incumbent regardless of how many challengers were refused.
 *  - On incumbent removal, the storm-summary INFO is logged exactly once with
 *    the total refused count.
 *
 * Unit tests cover the cooldown logic with fake timers + mock ws; this test
 * exercises the real @fastify/websocket + ws library + TCP path that the
 * mocks cannot model (async close events, network ordering).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyError } from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { WebSocket as WsClient } from 'ws';

vi.mock('../../src/auth', () => ({
  verifyToken: async (token: string) =>
    token === 'good'
      ? { valid: true, userId: 42, email: 't@t.com' }
      : { valid: false, reason: 'bad' },
}));

vi.mock('../../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { Logger } = await import('../../src/logger');
const { wsRoutes } = await import('../../src/sync/websocket.routes');
const { resetWsConnectionService } =
  await import('../../src/sync/services/websocket-connection.service');
const { pickErrorLogLevel } = await import('../../src/server');

interface Booted {
  app: FastifyInstance;
  wsUrl: string;
}

const buildApp = async (): Promise<Booted> => {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode ?? 500;
    const msg = `Request failed ${status} ${req.method} ${req.url}: ${error.name}: ${error.message}`;
    const level = pickErrorLogLevel(req.url, status);
    if (level === 'error') Logger.error(msg, error.stack);
    else if (level === 'debug') Logger.debug(msg);
    else Logger.warn(msg);
    return reply.send(error);
  });
  await app.register(rateLimit, { max: 500, timeWindow: '15 minutes' });
  await app.register(websocket, { options: { maxPayload: 1024 } });
  await app.register(wsRoutes, { prefix: '/api/sync' });
  await app.ready();
  const httpUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, wsUrl: httpUrl.replace(/^http:\/\//, 'ws://') };
};

const waitForConnected = (sock: WsClient): Promise<void> =>
  new Promise((resolve, reject) => {
    const onMsg = (data: Buffer): void => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          sock.off('message', onMsg);
          resolve();
        }
      } catch {
        // Ignore non-JSON frames.
      }
    };
    sock.on('message', onMsg);
    sock.once('error', reject);
  });

const waitForClose = (sock: WsClient): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => {
    sock.once('close', (code, reasonBuf) =>
      resolve({ code, reason: reasonBuf.toString() }),
    );
  });

describe('WebSocket reconnect-storm integration', () => {
  let booted: Booted;

  beforeEach(async () => {
    vi.mocked(Logger.info).mockClear();
    vi.mocked(Logger.warn).mockClear();
    vi.mocked(Logger.debug).mockClear();
    vi.mocked(Logger.error).mockClear();
    resetWsConnectionService();
    booted = await buildApp();
  });

  afterEach(async () => {
    await booted.app.close();
    resetWsConnectionService();
  });

  it('should keep one incumbent alive under a 20-challenger storm, warn once, then summarize on removal', async () => {
    const STORM = 20;
    const url = `${booted.wsUrl}/api/sync/ws?token=good&clientId=storm`;

    const incumbent = new WsClient(url);
    await waitForConnected(incumbent);

    let incumbentClosedDuringStorm = false;
    incumbent.on('close', () => {
      incumbentClosedDuringStorm = true;
    });

    // 20 challengers from the same clientId — the pre-18.6.0 storm shape.
    const refusalCodes: number[] = [];
    for (let i = 0; i < STORM; i++) {
      const challenger = new WsClient(url);
      const { code } = await waitForClose(challenger);
      refusalCodes.push(code);
    }

    expect(refusalCodes).toHaveLength(STORM);
    expect(refusalCodes.every((c) => c === 4008)).toBe(true);
    expect(incumbentClosedDuringStorm).toBe(false);
    expect(incumbent.readyState).toBe(WsClient.OPEN);

    // WARN logged exactly once for this clientId, despite STORM refusals.
    const stormWarns = vi
      .mocked(Logger.warn)
      .mock.calls.filter((c) => String(c[0]).includes('Reconnect within cooldown'));
    expect(stormWarns).toHaveLength(1);

    // Summary INFO should not have fired yet — incumbent still alive.
    const earlySummary = vi
      .mocked(Logger.info)
      .mock.calls.filter((c) => String(c[0]).includes('Refused'));
    expect(earlySummary).toHaveLength(0);

    // Closing the incumbent triggers the server-side close handler →
    // removeConnection → storm summary INFO (exactly once).
    const incumbentClosed = waitForClose(incumbent);
    incumbent.close();
    await incumbentClosed;

    await vi.waitFor(() => {
      const summary = vi
        .mocked(Logger.info)
        .mock.calls.filter((c) =>
          String(c[0]).includes(`Refused ${STORM} reconnect challenger(s)`),
        );
      expect(summary).toHaveLength(1);
    });
  });
});
