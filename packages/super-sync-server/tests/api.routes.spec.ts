import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { initDb, getDb } from '../src/db';
import { apiRoutes } from '../src/api';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = 'super-sync-dev-secret-do-not-use-in-production';

const createToken = (userId: number, email: string, tokenVersion: number = 0): string => {
  return jwt.sign({ userId, email, tokenVersion }, JWT_SECRET, { expiresIn: '7d' });
};

describe('API Routes - Replace Token', () => {
  let app: FastifyInstance;
  const userId = 1;
  const email = 'test@test.com';

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, token_version, created_at)
       VALUES (?, ?, 'hash', 1, 0, ?)`,
    ).run(userId, email, Date.now());

    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should replace token and return a new one', async () => {
    const oldToken = createToken(userId, email, 0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: `Bearer ${oldToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.token).not.toBe(oldToken);
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe(email);
  });

  it('should increment token_version in database', async () => {
    const oldToken = createToken(userId, email, 0);

    await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: `Bearer ${oldToken}`,
      },
    });

    const db = getDb();
    const user = db
      .prepare('SELECT token_version FROM users WHERE id = ?')
      .get(userId) as {
      token_version: number;
    };
    expect(user.token_version).toBe(1);
  });

  it('should invalidate old token after replacement', async () => {
    const oldToken = createToken(userId, email, 0);

    // Replace the token
    const replaceResponse = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: `Bearer ${oldToken}`,
      },
    });

    expect(replaceResponse.statusCode).toBe(200);
    const newToken = replaceResponse.json().token;

    // Try to use the old token - should fail
    const oldTokenResponse = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: `Bearer ${oldToken}`,
      },
    });

    expect(oldTokenResponse.statusCode).toBe(401);

    // New token should work
    const newTokenResponse = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: `Bearer ${newToken}`,
      },
    });

    expect(newTokenResponse.statusCode).toBe(200);
  });

  it('should return 401 without authorization header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Missing or invalid Authorization header');
  });

  it('should return 401 with invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid token');
  });

  it('should return 401 with expired token version', async () => {
    // Token with version 0, but we'll increment the DB version first
    const db = getDb();
    db.prepare('UPDATE users SET token_version = 5 WHERE id = ?').run(userId);

    const oldVersionToken = createToken(userId, email, 0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: `Bearer ${oldVersionToken}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid token');
  });
});

describe('API Routes - Verify Email', () => {
  let app: FastifyInstance;
  const email = 'verify@test.com';
  const verificationToken = 'token-123';

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();
    const expiresInMs = 60 * 60 * 1000;

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, verification_token, verification_token_expires_at, created_at)
       VALUES (1, ?, 'hash', 0, ?, ?, ?)`,
    ).run(email, verificationToken, Date.now() + expiresInMs, Date.now());

    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should verify email with valid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/verify-email',
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('Email verified successfully');

    const db = getDb();
    const user = db
      .prepare(
        'SELECT is_verified, verification_token, verification_token_expires_at FROM users WHERE email = ?',
      )
      .get(email) as { is_verified: number; verification_token: string | null };

    expect(user.is_verified).toBe(1);
    expect(user.verification_token).toBeNull();
  });

  it('should return 400 for invalid token and keep user unverified', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/verify-email',
      payload: { token: 'invalid-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid verification token');

    const db = getDb();
    const user = db
      .prepare('SELECT is_verified FROM users WHERE email = ?')
      .get(email) as { is_verified: number };
    expect(user.is_verified).toBe(0);
  });

  it('should return 400 for expired token', async () => {
    const db = getDb();
    db.prepare('UPDATE users SET verification_token_expires_at = ? WHERE email = ?').run(
      Date.now() - 1000,
      email,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/verify-email',
      payload: { token: verificationToken },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Verification token has expired');
  });
});
