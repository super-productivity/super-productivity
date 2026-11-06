/**
 * Regression test for #9885.
 *
 * Background: `/api/sync/ws` completes the WebSocket upgrade (HTTP 101)
 * BEFORE authenticating — required so a rejected client can see the
 * 4001/4003 close-code contract instead of a generic 1006 drop (see
 * AUTH_FAILURE_CLOSE_CODE in super-sync-websocket.service.ts). When the
 * server then rejects an unauthenticated connection with
 * `socket.close(code, reason)`, that only STARTS the WebSocket closing
 * handshake. `ws` itself waits up to 30s (CLOSE_TIMEOUT, ws/lib/websocket.js)
 * for the peer to echo a close frame before destroying the underlying TCP
 * socket. A peer that simply never answers therefore pins one fd + one
 * ws.WebSocket (+ Receiver/Sender) on the server for ~30s at zero cost to
 * itself.
 *
 * A standard `ws` client can't reproduce this: on receiving a close frame it
 * automatically calls `websocket.close(code, reason)` right back
 * (`receiverOnConclude` in ws/lib/websocket.js), which completes the
 * handshake immediately — cooperative by construction. So this test speaks
 * raw HTTP/TCP instead: it performs the WebSocket upgrade by hand via
 * `http.request`, gets the raw socket back on the `'upgrade'` event, and
 * then writes nothing further — a deliberately uncooperative peer, exactly
 * the scenario the bug depends on.
 *
 * Fixed behavior under test: `closeRejectedSocket()` in websocket.routes.ts
 * still sends the close frame (preserving the 4001/4003 contract), but arms
 * a short grace timer and calls `socket.terminate()` — an immediate,
 * handshake-free TCP kill — if the peer hasn't completed the handshake by
 * then. This test asserts the raw TCP connection is gone well within that
 * grace window, not after ws's 30s CLOSE_TIMEOUT.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import * as http from 'node:http';
import type { Socket } from 'node:net';

vi.mock('../../src/auth', () => ({
  verifyToken: async (token: string) => {
    if (token === 'auth-error') {
      throw new Error('Authentication unavailable');
    }
    return { valid: false, reason: 'Invalid token' };
  },
}));

vi.mock('../../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { wsRoutes, WS_REJECTED_SOCKET_GRACE_MS } =
  await import('../../src/sync/websocket.routes');

interface RawUpgrade {
  statusCode: number;
  socket: Socket;
  chunks: Buffer[];
}

/** Performs a WebSocket upgrade by hand and hands back the raw TCP socket,
 * without ever completing a `ws` closing handshake on it. */
const openRawUpgrade = (port: number, path: string): Promise<RawUpgrade> =>
  new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        // A fixed, well-formed key is fine — this test never validates the
        // Sec-WebSocket-Accept response, only that the upgrade completed and
        // what happens to the socket afterward.
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      // The close frame can arrive with the upgrade or in later TCP chunks.
      // Read it without replying, leaving the WebSocket handshake incomplete.
      const chunks = [head];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      resolve({ statusCode: res.statusCode ?? 0, socket, chunks });
    });
    req.on('response', (res) => {
      // e.g. a 429 from the rate limiter — no 'upgrade' event will fire for
      // this, so surface it instead of hanging the test.
      res.resume();
      reject(new Error(`Expected a WebSocket upgrade, got HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.end();
  });

const waitForRawClose = (socket: Socket, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    socket.once('close', onClose);
  });

describe('WebSocket rejected-socket teardown (real socket, uncooperative peer) - #9885', () => {
  let app: FastifyInstance | undefined;
  let rawSocket: Socket | undefined;

  afterEach(async () => {
    // Also release the uncooperative peer when an assertion fails, so server
    // teardown does not wait for ws's 30-second timeout in the red test.
    rawSocket?.destroy();
    rawSocket = undefined;
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it.each([
    {
      rejection: 'missing token',
      path: '/api/sync/ws',
      code: 4001,
      reason: 'Missing token',
    },
    {
      rejection: 'invalid clientId',
      path: '/api/sync/ws?token=invalid&clientId=invalid!',
      code: 4001,
      reason: 'Invalid clientId',
    },
    {
      rejection: 'invalid token',
      path: '/api/sync/ws?token=invalid&clientId=valid-client',
      code: 4003,
      reason: 'Invalid token',
    },
    {
      rejection: 'internal authentication error',
      path: '/api/sync/ws?token=auth-error&clientId=valid-client',
      code: 1011,
      reason: 'Internal error',
    },
  ])(
    'preserves the close frame and promptly terminates after $rejection',
    async ({ path, code, reason }) => {
      app = Fastify({ logger: false });
      await app.register(rateLimit, { max: 500, timeWindow: '15 minutes' });
      await app.register(websocket);
      await app.register(wsRoutes, { prefix: '/api/sync' });
      const httpUrl = await app.listen({ port: 0, host: '127.0.0.1' });
      const port = Number(new URL(httpUrl).port);

      const start = Date.now();
      const { statusCode, socket, chunks } = await openRawUpgrade(port, path);
      rawSocket = socket;

      // The vulnerability's precondition: the upgrade completes BEFORE auth is
      // checked, so an unauthenticated caller still gets a real socket.
      expect(statusCode).toBe(101);

      // Deliberately do nothing further with `socket` — no close frame is ever
      // echoed back. Historically this pinned the server-side TCP connection
      // open for ~30s (ws's CLOSE_TIMEOUT). Give this a generous safety margin
      // over the grace period so a regression to the old behavior fails
      // clearly rather than the test hanging until the runner's own timeout.
      const safetyNetMs = WS_REJECTED_SOCKET_GRACE_MS + 5_000;
      const closed = await waitForRawClose(socket, safetyNetMs);
      const elapsedMs = Date.now() - start;

      expect(closed).toBe(true);
      // Must land near the grace period, nowhere near ws's 30s CLOSE_TIMEOUT.
      expect(elapsedMs).toBeLessThan(WS_REJECTED_SOCKET_GRACE_MS + 3_000);

      // Server close frames are unmasked. These short reasons fit in the
      // single-byte payload length, followed by the two-byte close code.
      const closeFrame = Buffer.concat(chunks);
      expect(closeFrame[0]).toBe(0x88);
      expect(closeFrame[1]).toBe(2 + Buffer.byteLength(reason));
      expect(closeFrame.readUInt16BE(2)).toBe(code);
      expect(closeFrame.subarray(4).toString('utf8')).toBe(reason);
    },
    20_000,
  );
});
