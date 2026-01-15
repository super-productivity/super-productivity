import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const originalEnv = { ...process.env };

const resetEnv = (): void => {
  process.env = { ...originalEnv };
};

describe('Email transport configuration', () => {
  beforeEach(() => {
    resetEnv();
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
  });

  it('should fail gracefully in production without SMTP configuration', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://example.com';

    const { sendVerificationEmail } = await import('../src/email');
    const result = await sendVerificationEmail('user@test.com', 'token');
    expect(result).toBe(false);
  });
});
