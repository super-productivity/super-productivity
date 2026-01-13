import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { initDb } from '../src/db';
import { apiRoutes } from '../src/api';

// Mock email sending
vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));

describe('API Routes - Registration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    initDb('./data', true);
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should register successfully with termsAccepted: true', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: {
        email: 'api-reg@test.com',
        password: 'ValidPassword123!',
        termsAccepted: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().message).toContain('Registration successful');
  });

  it('should fail if termsAccepted is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: {
        email: 'api-fail@test.com',
        password: 'ValidPassword123!',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation failed');
    const details = response.json().details;
    // Check for either the message or the path being termsAccepted
    const hasTermsError = details.some(
      (d: any) =>
        d.message === 'You must accept the Terms of Service' ||
        d.path.includes('termsAccepted'),
    );
    expect(hasTermsError).toBe(true);
  });

  it('should fail if termsAccepted is false', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: {
        email: 'api-fail2@test.com',
        password: 'ValidPassword123!',
        termsAccepted: false,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation failed');
  });
});
