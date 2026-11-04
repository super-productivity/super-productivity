import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as jwt from 'jsonwebtoken';
import { connectRoutes } from '../src/connect/connect.routes';
import {
  approveConnectRequest,
  CONNECT_REQUEST_TTL_MS,
  createConnectRequest,
  deleteExpiredConnectRequests,
  pendingConnectRequestId,
  pollConnectRequest,
} from '../src/connect/connect-request.store';
import { revokeAllTokens, signAccountToken, verifyToken } from '../src/auth';
import { authCache } from '../src/auth-cache';
import {
  addUser,
  createCapturePrisma,
  createCaptureSchema,
} from './capture-pglite.helper';

const mocked = vi.hoisted(() => {
  process.env.JWT_SECRET = 'connect-test-secret-longer-than-32-characters';
  return { prisma: {} as Record<string, unknown> };
});
vi.mock('../src/db', () => ({ prisma: mocked.prisma }));
// The shared test setup mocks auth; these tests need the real signing and checks.
vi.mock('../src/auth', async (original) => original());

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations/20261103000000_connect_requests/migration.sql',
);

interface Created {
  requestId: string;
  pollSecret: string;
  matchCode: string;
  expiresAt: number;
  pollIntervalMs: number;
}

describe('browser sign-in of a new device (real routes and SQL)', () => {
  let db: PGlite;
  let app: FastifyInstance;
  let userId: number;
  let otherUserId: number;
  let userJwt: string;
  let otherJwt: string;

  const create = async (
    payload: object = { deviceName: 'Pixel 8', platform: 'android' },
  ) => app.inject({ method: 'POST', url: '/api/connect/requests', payload });
  const created = async (): Promise<Created> => {
    const res = await create();
    expect(res.statusCode).toBe(200);
    return res.json<Created>();
  };
  const asUser = (method: 'GET' | 'POST', path: string, token = userJwt) =>
    app.inject({
      method,
      url: `/api/connect/requests/${path}`,
      headers: { authorization: `Bearer ${token}` },
    });
  const poll = (req: Pick<Created, 'requestId' | 'pollSecret'>) =>
    app.inject({
      method: 'POST',
      url: `/api/connect/requests/${req.requestId}/poll`,
      payload: { pollSecret: req.pollSecret },
    });
  const tokenVersion = async (id: number) =>
    (
      await db.query<{ v: number }>(
        'SELECT token_version AS v FROM users WHERE id = $1',
        [id],
      )
    ).rows[0].v;
  const loginToken = async (id: number, email: string) =>
    signAccountToken(id, email, await tokenVersion(id));

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    Object.assign(mocked.prisma, createCapturePrisma(db));
  });

  beforeEach(async () => {
    authCache.clear();
    // Fresh app per test: rate-limit counters must not carry over.
    app = Fastify();
    await app.register(rateLimit, { max: 500, timeWindow: '15 minutes' });
    await app.register(connectRoutes, { prefix: '/api/connect' });
    await app.ready();
    // Sign-out also touches the capture tables, so the schema includes them.
    await db.exec('DROP TABLE IF EXISTS connect_requests');
    await createCaptureSchema(db);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    userId = await addUser(db, 'me@example.com');
    otherUserId = await addUser(db, 'other@example.com');
    userJwt = await loginToken(userId, 'me@example.com');
    otherJwt = await loginToken(otherUserId, 'other@example.com');
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await db.close();
  });

  it('hands the app a working account token once, after Connect', async () => {
    const req = await created();
    expect(req.matchCode).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
    expect(req.pollIntervalMs).toBeGreaterThan(0);
    expect((await poll(req)).json()).toEqual({ status: 'pending' });

    const details = await asUser('GET', req.requestId);
    expect(details.json()).toEqual({
      deviceName: 'Pixel 8',
      platform: 'android',
      matchCode: req.matchCode,
    });
    expect((await asUser('POST', `${req.requestId}/approve`)).statusCode).toBe(200);

    const approved = (await poll(req)).json<{ status: string; token: string }>();
    expect(approved.status).toBe('approved');
    expect(await verifyToken(approved.token)).toMatchObject({ valid: true, userId });
    // The first device stays signed in: no token replacement.
    expect(await verifyToken(userJwt)).toMatchObject({ valid: true });
    expect((await poll(req)).json()).toEqual({ status: 'expired' });
  });

  it('sends no-store and no-referrer on every answer', async () => {
    const res = await create();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('answers a wrong secret and an unknown id like an expired request', async () => {
    const req = await created();
    await asUser('POST', `${req.requestId}/approve`);
    const wrong = { requestId: req.requestId, pollSecret: 'x'.repeat(43) };
    expect((await poll(wrong)).json()).toEqual({ status: 'expired' });
    const unknown = { requestId: 'a'.repeat(22), pollSecret: req.pollSecret };
    expect((await poll(unknown)).json()).toEqual({ status: 'expired' });
    const malformed = { requestId: 'short', pollSecret: 'short' };
    expect((await poll(malformed)).json()).toEqual({ status: 'expired' });
    // The real secret still claims it: wrong guesses don't burn the request.
    expect((await poll(req)).json()).toMatchObject({ status: 'approved' });
  });

  it('reports a cancel, before and after Connect, and never hands out a token', async () => {
    const before = await created();
    expect((await asUser('POST', `${before.requestId}/cancel`)).statusCode).toBe(200);
    expect((await poll(before)).json()).toEqual({ status: 'denied' });

    const after = await created();
    await asUser('POST', `${after.requestId}/approve`);
    expect((await asUser('POST', `${after.requestId}/cancel`)).statusCode).toBe(200);
    expect((await poll(after)).json()).toEqual({ status: 'denied' });
  });

  it('lets only the approving account cancel an approved request', async () => {
    const req = await created();
    await asUser('POST', `${req.requestId}/approve`);
    expect((await asUser('POST', `${req.requestId}/cancel`, otherJwt)).statusCode).toBe(
      404,
    );
    expect((await poll(req)).json()).toMatchObject({ status: 'approved' });
  });

  it('refuses a second account approving a request another already approved', async () => {
    const req = await created();
    await asUser('POST', `${req.requestId}/approve`);
    expect((await asUser('POST', `${req.requestId}/approve`, otherJwt)).statusCode).toBe(
      404,
    );
    const token = (await poll(req)).json<{ token: string }>().token;
    expect(await verifyToken(token)).toMatchObject({ valid: true, userId });
  });

  it('stops the claim when the account signs out between Connect and claim', async () => {
    const req = await created();
    await asUser('POST', `${req.requestId}/approve`);
    await revokeAllTokens(userId);
    expect((await poll(req)).json()).toEqual({ status: 'expired' });
  });

  it('refuses Connect when the account signed out after the page logged in', async () => {
    const req = await created();
    const pageVersion = await tokenVersion(userId);
    await revokeAllTokens(userId);
    expect(
      await approveConnectRequest(req.requestId, { userId, tokenVersion: pageVersion }),
    ).toBe(false);
    expect((await asUser('POST', `${req.requestId}/approve`)).statusCode).toBe(401);
  });

  it('requires a login for the page routes', async () => {
    const req = await created();
    for (const path of [req.requestId, `${req.requestId}/approve`]) {
      const res = await app.inject({
        method: path === req.requestId ? 'GET' : 'POST',
        url: `/api/connect/requests/${path}`,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('expires requests after ten minutes', async () => {
    const now = Date.now();
    const req = await createConnectRequest(
      { deviceName: 'Pixel 8', platform: 'android' },
      now,
    );
    const later = now + CONNECT_REQUEST_TTL_MS;
    expect(await pollConnectRequest(req.requestId, req.pollSecret, later)).toEqual({
      status: 'expired',
    });
    expect((await asUser('GET', req.requestId)).statusCode).toBe(200);
    expect(await deleteExpiredConnectRequests(later)).toBe(1);
    expect((await asUser('GET', req.requestId)).statusCode).toBe(404);
  });

  it('lets emails link only a request that can still be connected', async () => {
    const req = await created();
    expect(await pendingConnectRequestId(req.requestId)).toBe(req.requestId);
    await asUser('POST', `${req.requestId}/approve`);
    expect(await pendingConnectRequestId(req.requestId)).toBeUndefined();
    expect(await pendingConnectRequestId(undefined)).toBeUndefined();
  });

  it('prunes expired requests on every create', async () => {
    await createConnectRequest({ deviceName: 'Old', platform: 'web' }, 0);
    await created();
    const rows = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM connect_requests',
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('rejects a long, empty or control-character device name and an unknown platform', async () => {
    for (const payload of [
      { deviceName: 'x'.repeat(41), platform: 'android' },
      { deviceName: '   ', platform: 'android' },
      { deviceName: 'a\nb', platform: 'android' },
      { deviceName: 'Pixel', platform: 'toaster' },
    ]) {
      expect((await create(payload)).statusCode).toBe(400);
    }
    expect(
      (await create({ deviceName: `  ${'x'.repeat(40)}  `, platform: 'ios' })).statusCode,
    ).toBe(200);
  });

  it('limits polling per request, not per IP', async () => {
    const busy = await created();
    let last = await poll(busy);
    for (let i = 0; i < 400 && last.statusCode === 200; i++) last = await poll(busy);
    expect(last.statusCode).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
    const other = await created();
    expect((await poll(other)).statusCode).toBe(200);
  });

  it('limits creates per IP', async () => {
    const ip = '203.0.113.9';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/connect/requests',
        remoteAddress: ip,
        payload: { deviceName: 'Pixel 8', platform: 'android' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('signs the claimed token with the same claims as a login token', async () => {
    const req = await created();
    await asUser('POST', `${req.requestId}/approve`);
    const token = (await poll(req)).json<{ token: string }>().token;
    expect(jwt.decode(token)).toMatchObject({
      userId,
      email: 'me@example.com',
      tokenVersion: await tokenVersion(userId),
    });
  });
});
