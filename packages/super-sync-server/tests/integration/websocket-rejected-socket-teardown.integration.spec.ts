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
  // No token is sent at all in this test, so the route rejects before
  // verifyToken is even reached — this mock only has to exist to satisfy the
  // module import.
  verifyToken: async () => ({ valid: false, reason: 'unused in this test' }),
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
    req.on('upgrade', (res, socket) => {
      resolve({ statusCode: res.statusCode ?? 0, socket });
    });
    req.on('response', (res) => {
      // e.g. a 429 from the rate limiter — no 'upgrade' event will fire for
      // this, so surface it instead of hanging the test.
      reject(new Error(`Expected a WebSocket upgrade, got HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.end();
  });

const waitForRawClose = (socket: Socket, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    socket.once('close', () => resolve(true));
    setTimeout(() => resolve(false), timeoutMs);
  });

describe('WebSocket rejected-socket teardown (real socket, uncooperative peer) - #9885', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('terminates a rejected socket within the grace period, not ws’s 30s CLOSE_TIMEOUT', async () => {
    app = Fastify({ logger: false });
    await app.register(rateLimit, { max: 500, timeWindow: '15 minutes' });
    await app.register(websocket);
    await app.register(wsRoutes, { prefix: '/api/sync' });
    const httpUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const port = Number(new URL(httpUrl).port);

    // No token in the querystring -> the route rejects with 4001 ("Missing
    // token") immediately after completing the upgrade.
    const start = Date.now();
    const { statusCode, socket } = await openRawUpgrade(port, '/api/sync/ws');

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
  }, 20_000);
});
