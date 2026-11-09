import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import * as jwt from 'jsonwebtoken';
import { captureRoutes, captureMcpRoutes } from '../src/capture';
import { captureOAuthRoutes } from '../src/capture/capture-oauth.routes';
import {
  DEFAULT_CAPTURE_OAUTH_CLIENTS,
  CaptureOAuthClientsSchema,
} from '../src/capture/capture-oauth-clients';
import {
  pkceChallenge,
  REFRESH_GRACE_MS,
  REFRESH_TTL_MS,
} from '../src/capture/capture-oauth-token';
import { resetCaptureRateLimitForTests } from '../src/capture/capture-rate-limit';
import {
  createCaptureSchema,
  createCapturePrisma,
  addUser,
  newCaptureKeyPair,
  openCapture,
} from './capture-pglite.helper';
import {
  authenticateCaptureToken,
  deleteDeadCaptureGrants,
  listCaptureGrants,
} from '../src/capture/capture-grant.store';
import { revokeAllTokens } from '../src/auth';
import {
  createCaptureConnectCode,
  refreshCaptureAuthorization,
} from '../src/capture/capture-oauth.store';
import { parseCaptureReviewAccess } from '../src/capture/capture-review';

const mocked = vi.hoisted(() => {
  process.env.JWT_SECRET = 'oauth-test-secret-longer-than-32-characters';
  return { prisma: {} as Record<string, unknown> };
});
vi.mock('../src/db', () => ({ prisma: mocked.prisma }));
vi.mock('../src/auth', async (original) => original());
const issuer = 'https://sync.example';
const resource = `${issuer}/mcp`;
const client = DEFAULT_CAPTURE_OAUTH_CLIENTS[0];
const verifier = 'v'.repeat(43);
const signingKey = process.env.JWT_SECRET!;

const REVIEW_CODE = 'REVIEW-ABCD-EFGH-JKMN-PQRS';

describe('capture OAuth (real routes and SQL)', () => {
  let db: PGlite;
  let app: FastifyInstance;
  /** The same routes with an operator-set reviewer code for the test account. */
  let reviewApp: FastifyInstance;
  let userId: number;
  let syncJwt: string;
  let key: ReturnType<typeof newCaptureKeyPair>;
  const api = (
    method: 'POST' | 'PUT' | 'DELETE' | 'GET',
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/capture${path}`,
      headers: { authorization: `Bearer ${syncJwt}` },
      payload,
    });
  const connectCode = async () => {
    const res = await api('POST', '/connect-code');
    expect(res.statusCode).toBe(200);
    return res.json<{ code: string }>().code;
  };
  const authorize = (overrides: Record<string, string> = {}, ip = '127.0.0.1') =>
    app.inject({
      method: 'GET',
      remoteAddress: ip,
      url: `/oauth/authorize?${new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0],
        resource,
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: pkceChallenge(verifier),
        scope: 'tasks:capture offline_access',
        state: 'my-state',
        ...overrides,
      })}`,
    });
  const authId = async (overrides: Record<string, string> = {}) => {
    const res = await authorize(overrides);
    expect(res.statusCode).toBe(200);
    return /data-auth-id="([^"]+)"/.exec(res.body)![1];
  };
  const approve = (id: string, code: string, ip = '127.0.0.1', target = app) =>
    target.inject({
      method: 'POST',
      url: '/oauth/authorize/approve',
      remoteAddress: ip,
      payload: { authId: id, code },
    });
  const authorizationCode = async (overrides: Record<string, string> = {}) => {
    const response = await approve(await authId(overrides), await connectCode());
    expect(response.statusCode).toBe(200);
    const url = new URL(response.json().redirect);
    expect(url.searchParams.get('state')).toBe('my-state');
    expect(url.searchParams.get('iss')).toBe(issuer);
    return url.searchParams.get('code')!;
  };
  const token = (params: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(params).toString(),
    });
  const exchange = (code: string, overrides: Record<string, string> = {}) =>
    token({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      redirect_uri: client.redirectUris[0],
      resource,
      code_verifier: verifier,
      ...overrides,
    });
  const pair = async () => {
    const response = await exchange(await authorizationCode());
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return response.json<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>();
  };
  const refresh = (refreshToken: string, overrides: Record<string, string> = {}) =>
    token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.clientId,
      resource,
      ...overrides,
    });

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    Object.assign(mocked.prisma, createCapturePrisma(db));
    app = Fastify();
    await app.register(captureRoutes, { prefix: '/api/capture' });
    await app.register(captureMcpRoutes, { publicUrl: issuer });
    await app.register(captureOAuthRoutes, {
      publicUrl: issuer,
      signingKey,
      clients: DEFAULT_CAPTURE_OAUTH_CLIENTS,
    });
    await app.ready();
    reviewApp = Fastify();
    await reviewApp.register(captureOAuthRoutes, {
      publicUrl: issuer,
      signingKey,
      clients: DEFAULT_CAPTURE_OAUTH_CLIENTS,
      review: parseCaptureReviewAccess('OAuth@Example.com', REVIEW_CODE),
    });
    await reviewApp.ready();
  });
  afterAll(async () => {
    await app.close();
    await reviewApp.close();
    await db.close();
  });
  beforeEach(async () => {
    resetCaptureRateLimitForTests();
    await createCaptureSchema(db);
    userId = await addUser(db, 'oauth@example.com');
    syncJwt = jwt.sign(
      { userId, email: 'oauth@example.com', tokenVersion: 0 },
      signingKey,
    );
    key = newCaptureKeyPair();
    expect((await api('PUT', '/key', { publicKey: key.publicKey })).statusCode).toBe(200);
  });

  it('accepts Claude initialization fallback with Mcp-Method after modern discovery', async () => {
    const tokens = await pair();
    const request = (method: string, version?: string) =>
      app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'mcp-method': method,
          ...(version ? { 'mcp-protocol-version': version } : {}),
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method,
          ...(method === 'initialize'
            ? {
                params: {
                  protocolVersion: '2025-11-25',
                  capabilities: {},
                  clientInfo: { name: 'Claude', version: '1' },
                },
              }
            : {}),
        },
      });
    expect((await request('server/discover', '2026-07-28')).statusCode).toBe(400);
    const initialized = await request('initialize');
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result.protocolVersion).toBe('2025-11-25');
    const listed = await request('tools/list', '2025-11-25');
    expect(listed.statusCode).toBe(200);
    expect(listed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      ['create_task'],
    );
  });

  it('discovers OAuth and authorizes encrypted, write-only capture', async () => {
    const unauthorized = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers['www-authenticate']).toContain(
      `${issuer}/.well-known/oauth-protected-resource/mcp`,
    );
    const prm = (await app.inject('/.well-known/oauth-protected-resource/mcp')).json();
    expect(prm).toMatchObject({ resource, authorization_servers: [issuer] });
    const metadata = (await app.inject('/.well-known/oauth-authorization-server')).json();
    expect(metadata).toMatchObject({
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    });
    const tokens = await pair();
    expect(tokens.expires_in).toBe(3600);
    const created = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${tokens.access_token}` },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'OAuth #foo +bar tomorrow' } },
      },
    });
    expect(created.json().result.content[0].text).toContain('Saved.');
    const rows = await db.query<{ id: string; ciphertext: string }>(
      'SELECT id, ciphertext FROM capture_items',
    );
    expect(openCapture(key.ecdh, rows.rows[0].id, rows.rows[0].ciphertext)).toMatchObject(
      { title: 'OAuth #foo +bar tomorrow' },
    );
    const wrongApi = await app.inject({
      method: 'GET',
      url: '/api/capture/grants',
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(wrongApi.statusCode).toBe(401);
  });

  it.each([
    { client_id: 'https://attacker.example/client' },
    { redirect_uri: 'https://claude.ai.attacker.example/api/mcp/auth_callback' },
    { redirect_uri: 'https://claude.ai/api/mcp/auth_callback?extra=1' },
    { resource: 'https://other.example/mcp' },
    { code_challenge_method: 'plain' },
    { code_challenge: 'short' },
    { scope: 'tasks:read' },
  ])('rejects invalid authorization %j without redirecting', async (overrides) => {
    const res = await authorize(overrides);
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect((await db.query('SELECT * FROM capture_auth')).rows).toHaveLength(0);
  });

  it('accepts the pinned ChatGPT client only on its stable callback', async () => {
    const chatGpt = DEFAULT_CAPTURE_OAUTH_CLIENTS.find((c) => c.name === 'ChatGPT')!;
    const overrides = {
      client_id: chatGpt.clientId,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    };
    const code = await authorizationCode(overrides);
    expect((await exchange(code, overrides)).statusCode).toBe(200);
    const perConnection = await authorize({
      ...overrides,
      redirect_uri: 'https://chatgpt.com/connector/oauth/abc123',
    });
    expect(perConnection.statusCode).toBe(400);
  });

  it.each(['localhost', '127.0.0.1'])(
    'accepts a pinned Claude Code callback on any port (%s)',
    async (host) => {
      const overrides = {
        client_id: DEFAULT_CAPTURE_OAUTH_CLIENTS[1].clientId,
        redirect_uri: `http://${host}:43123/callback`,
      };
      expect((await authorize(overrides)).body).toContain('runs on your computer');
      const code = await authorizationCode(overrides);
      expect((await exchange(code, overrides)).statusCode).toBe(200);
      expect(
        (
          await authorize({
            ...overrides,
            redirect_uri: `http://${host}:43123/elsewhere`,
          })
        ).statusCode,
      ).toBe(400);
    },
  );

  it('replaces and consumes connection codes once; rejects cross-origin approval', async () => {
    const id = await authId();
    const old = await connectCode();
    const current = await connectCode();
    expect((await approve(id, old)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/oauth/authorize/approve',
          headers: { origin: 'https://attacker.example' },
          payload: { authId: id, code: current },
        })
      ).statusCode,
    ).toBe(403);
    expect((await approve(id, current)).statusCode).toBe(200);
    expect((await approve(await authId(), current)).statusCode).toBe(400);
    expect((await approve(id, await connectCode())).statusCode).toBe(400);
  });

  it('binds exchange to PKCE, redirect, client and resource; consumes code once', async () => {
    const code = await authorizationCode();
    for (const overrides of [
      { code_verifier: 'x'.repeat(43) },
      { redirect_uri: 'https://claude.ai/other' },
      { client_id: DEFAULT_CAPTURE_OAUTH_CLIENTS[1].clientId },
      { resource: 'https://other.example/mcp' },
    ]) {
      expect((await exchange(code, overrides)).statusCode).toBe(400);
    }
    expect((await exchange(code)).statusCode).toBe(200);
    expect((await exchange(code)).json().error).toBe('invalid_grant');
  });

  it('expires both short-lived codes', async () => {
    const id = await authId();
    const connect = await connectCode();
    await db.exec('UPDATE capture_connect_codes SET expires_at = 0');
    expect((await approve(id, connect)).statusCode).toBe(400);
    const code = await authorizationCode();
    await db.exec('UPDATE capture_auth SET expires_at = 0');
    expect((await exchange(code)).json().error).toBe('invalid_grant');
  });

  it('rotates refresh tokens, returns the identical pair for a lost response, and revokes replay', async () => {
    const first = await pair();
    const rotated = (await refresh(first.refresh_token)).json();
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    const retry = (await refresh(first.refresh_token)).json();
    expect(retry.access_token).toBe(rotated.access_token);
    expect(retry.refresh_token).toBe(rotated.refresh_token);
    expect(await authenticateCaptureToken(rotated.access_token)).not.toBeNull();
    await db.query('UPDATE capture_grants SET rotated_at = $1', [
      Date.now() - REFRESH_GRACE_MS - 1,
    ]);
    expect((await refresh(first.refresh_token)).json().error).toBe('invalid_grant');
    expect(await authenticateCaptureToken(rotated.access_token)).toBeNull();
    expect((await refresh(rotated.refresh_token)).json().error).toBe('invalid_grant');
  });

  it('revokes an older issued token even within the latest rotation grace window', async () => {
    const first = await pair();
    const second = (await refresh(first.refresh_token)).json();
    const third = (await refresh(second.refresh_token)).json();
    expect(await authenticateCaptureToken(third.access_token)).not.toBeNull();
    expect((await refresh(first.refresh_token)).json().error).toBe('invalid_grant');
    expect(await authenticateCaptureToken(third.access_token)).toBeNull();
    expect((await refresh(third.refresh_token)).json().error).toBe('invalid_grant');
  });

  it('returns a conflict when creating a connection code with capture disabled', async () => {
    await api('DELETE', '/key');
    const response = await api('POST', '/connect-code');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'capture_disabled' });
    expect((await db.query('SELECT * FROM capture_connect_codes')).rows).toHaveLength(0);
  });

  it('keeps known-grant failures out of the shared IP quota for new exchanges', async () => {
    const first = await pair();
    const code = await authorizationCode();
    await db.exec('UPDATE capture_grants SET expires_at = 0');
    for (let i = 0; i < 120; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${first.access_token}` },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    }
    expect((await exchange(code)).statusCode).toBe(200);
    expect((await refresh(first.refresh_token)).statusCode).toBe(429);
  });

  it('does not revoke for a forged refresh token or wrong resource/client', async () => {
    const first = await pair();
    expect((await refresh(first.refresh_token.slice(0, -2) + 'xx')).statusCode).toBe(400);
    expect(
      (await refresh(first.refresh_token, { resource: 'https://other.example/mcp' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await refresh(first.refresh_token, {
          client_id: DEFAULT_CAPTURE_OAUTH_CLIENTS[1].clientId,
        })
      ).statusCode,
    ).toBe(400);
    expect(await authenticateCaptureToken(first.access_token)).not.toBeNull();
  });

  it('keeps a refreshable grant after access expiry, then expires it after 90 unused days', async () => {
    const first = await pair();
    const later = Date.now() + 2 * 60 * 60 * 1000;
    expect(await authenticateCaptureToken(first.access_token, later)).toBeNull();
    expect(await deleteDeadCaptureGrants(later)).toBe(0);
    expect(await listCaptureGrants(userId, later)).toHaveLength(1);
    expect(
      await refreshCaptureAuthorization(
        first.refresh_token,
        client.clientId,
        resource,
        signingKey,
        later,
      ),
    ).not.toBeNull();
    expect(
      await refreshCaptureAuthorization(
        first.refresh_token,
        client.clientId,
        resource,
        signingKey,
        later + REFRESH_TTL_MS + 1,
      ),
    ).toBeNull();
  });

  it('accepts reordered or narrowed refresh scopes and refuses expansion', async () => {
    const first = await pair();
    expect(
      (await refresh(first.refresh_token, { scope: 'offline_access tasks:capture' }))
        .statusCode,
    ).toBe(200);
    const narrowed = await refresh(first.refresh_token, { scope: 'tasks:capture' });
    expect(narrowed.statusCode).toBe(200);
    expect(narrowed.json().scope).toBe('tasks:capture');
    expect(
      (await refresh(first.refresh_token, { scope: 'tasks:capture tasks:read' })).json()
        .error,
    ).toBe('invalid_scope');
    expect((await token({ grant_type: 'client_credentials' })).json().error).toBe(
      'unsupported_grant_type',
    );
  });

  it('does not issue a refresh token without offline_access', async () => {
    const result = await exchange(await authorizationCode({ scope: 'tasks:capture' }));
    expect(result.json().refresh_token).toBeUndefined();
  });

  it.each(['signout', 'disable', 'revoke'])(
    '%s prevents refresh and further access',
    async (action) => {
      const first = await pair();
      const code = await authorizationCode();
      const pendingId = await authId();
      const connect = await connectCode();
      if (action === 'signout') await revokeAllTokens(userId);
      else if (action === 'disable') await api('DELETE', '/key');
      else await api('DELETE', `/grants/${(await listCaptureGrants(userId))[0].id}`);
      expect((await refresh(first.refresh_token)).json().error).toBe('invalid_grant');
      expect(await authenticateCaptureToken(first.access_token)).toBeNull();
      if (action !== 'revoke') {
        expect((await exchange(code)).json().error).toBe('invalid_grant');
        expect((await approve(pendingId, connect)).statusCode).toBe(400);
      }
    },
  );

  it('rejects code creation by a request authenticated before sign-out', async () => {
    await revokeAllTokens(userId);
    expect(await createCaptureConnectCode(userId, 0)).toBeNull();
    expect((await db.query('SELECT * FROM capture_connect_codes')).rows).toHaveLength(0);
  });

  it('limits authorization creation per IP', async () => {
    for (let i = 0; i < 20; i++) expect((await authorize()).statusCode).toBe(200);
    expect((await authorize()).statusCode).toBe(429);
  });

  it('limits approval guesses per IP without blocking other users', async () => {
    const pendingId = await authId();
    const connect = await connectCode();
    for (let ip = 1; ip <= 30; ip++) {
      for (let i = 0; i < 10; i++)
        expect((await approve('a'.repeat(43), 'WRONG', `192.0.2.${ip}`)).statusCode).toBe(
          400,
        );
      expect((await approve('a'.repeat(43), 'WRONG', `192.0.2.${ip}`)).statusCode).toBe(
        429,
      );
    }
    expect((await approve(pendingId, connect, '192.0.2.31')).statusCode).toBe(200);
  });

  describe('reviewer code', () => {
    const reviewAuthId = async () => {
      const res = await reviewApp.inject({
        method: 'GET',
        url: `/oauth/authorize?${new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: client.redirectUris[0],
          resource,
          response_type: 'code',
          code_challenge_method: 'S256',
          code_challenge: pkceChallenge(verifier),
          scope: 'tasks:capture offline_access',
          state: 'review',
        })}`,
      });
      expect(res.statusCode).toBe(200);
      return /data-auth-id="([^"]+)"/.exec(res.body)![1];
    };

    it('approves the demo account repeatedly, as typed or normalized', async () => {
      for (const code of [REVIEW_CODE, REVIEW_CODE.toLowerCase().replace(/-/g, ' ')]) {
        const response = await approve(
          await reviewAuthId(),
          code,
          '127.0.0.1',
          reviewApp,
        );
        expect(response.statusCode).toBe(200);
        expect(new URL(response.json().redirect).searchParams.get('code')).toBeTruthy();
      }
      const bound = await db.query<{ user_id: number }>(
        'SELECT user_id FROM capture_auth WHERE code_hash IS NOT NULL',
      );
      expect(bound.rows.map((row) => row.user_id)).toEqual([userId, userId]);
    });

    it('does not consume or replace the account’s connect code', async () => {
      const connect = await connectCode();
      expect(
        (await approve(await reviewAuthId(), REVIEW_CODE, '127.0.0.1', reviewApp))
          .statusCode,
      ).toBe(200);
      expect(
        (await approve(await reviewAuthId(), connect, '127.0.0.1', reviewApp)).statusCode,
      ).toBe(200);
    });

    it('refuses a wrong code and a demo account with capture switched off', async () => {
      expect(
        (
          await approve(
            await reviewAuthId(),
            'REVIEW-ABCD-EFGH-JKMN-PQRT',
            '127.0.0.1',
            reviewApp,
          )
        ).statusCode,
      ).toBe(400);
      expect((await api('DELETE', '/key')).statusCode).toBe(200);
      expect(
        (await approve(await reviewAuthId(), REVIEW_CODE, '127.0.0.1', reviewApp))
          .statusCode,
      ).toBe(400);
    });

    it('is not accepted where no reviewer code is configured', async () => {
      expect((await approve(await authId(), REVIEW_CODE)).statusCode).toBe(400);
    });

    it('binds only the configured account', async () => {
      const otherApp = Fastify();
      await otherApp.register(captureOAuthRoutes, {
        publicUrl: issuer,
        signingKey,
        clients: DEFAULT_CAPTURE_OAUTH_CLIENTS,
        review: parseCaptureReviewAccess('nobody@example.com', REVIEW_CODE),
      });
      await otherApp.ready();
      const res = await otherApp.inject({
        method: 'GET',
        url: `/oauth/authorize?${new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: client.redirectUris[0],
          resource,
          response_type: 'code',
          code_challenge_method: 'S256',
          code_challenge: pkceChallenge(verifier),
        })}`,
      });
      const id = /data-auth-id="([^"]+)"/.exec(res.body)![1];
      expect((await approve(id, REVIEW_CODE, '127.0.0.1', otherApp)).statusCode).toBe(
        400,
      );
      await otherApp.close();
    });

    it('needs both settings and a long enough code', () => {
      expect(parseCaptureReviewAccess(undefined, undefined)).toBeUndefined();
      expect(parseCaptureReviewAccess('  ', '')).toBeUndefined();
      expect(() => parseCaptureReviewAccess('demo@example.com', undefined)).toThrow(
        /both/,
      );
      expect(() => parseCaptureReviewAccess(undefined, REVIEW_CODE)).toThrow(/both/);
      expect(() => parseCaptureReviewAccess('demo@example.com', 'SHORT-CODE')).toThrow(
        /20 to 32/,
      );
      // 20 characters, but dashes do not count toward the minimum.
      expect(() =>
        parseCaptureReviewAccess('demo@example.com', 'ABCD-EFGH-JKMN-PQRS-'),
      ).toThrow(/20 to 32/);
      expect(() => parseCaptureReviewAccess('demo@example.com', 'A'.repeat(33))).toThrow(
        /20 to 32/,
      );
    });
  });

  it('rejects insecure allowlist configuration', () => {
    expect(
      CaptureOAuthClientsSchema.safeParse([
        { ...client, redirectUris: ['http://attacker.example/callback'] },
      ]).success,
    ).toBe(false);
    expect(CaptureOAuthClientsSchema.safeParse([client, client]).success).toBe(false);
  });
});
