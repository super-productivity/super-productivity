import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfigFromEnv } from '../src/config';

// Store original env
const originalEnv = { ...process.env };

const resetEnv = (): void => {
  process.env = { ...originalEnv };
};

describe('Security Fixes', () => {
  beforeEach(() => {
    resetEnv();
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
  });

  describe('Wildcard CORS Blocking in Production', () => {
    it('should throw error when CORS_ORIGINS=* in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'https://example.com';
      process.env.CORS_ORIGINS = '*';

      expect(() => loadConfigFromEnv()).toThrow(
        'CORS_ORIGINS wildcard (*) is not allowed in production',
      );
    });

    it('should allow wildcard CORS in development with warning', () => {
      process.env.NODE_ENV = 'development';
      process.env.CORS_ORIGINS = '*';

      // Should not throw
      const config = loadConfigFromEnv();
      expect(config.cors.allowedOrigins).toContain('*');
    });

    it('should allow explicit origins in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'https://example.com';
      process.env.CORS_ORIGINS = 'https://app.example.com,https://admin.example.com';

      const config = loadConfigFromEnv();
      expect(config.cors.allowedOrigins).toEqual([
        'https://app.example.com',
        'https://admin.example.com',
      ]);
    });

    it('should throw when wildcard is one of multiple origins in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'https://example.com';
      process.env.CORS_ORIGINS = 'https://example.com,*';

      expect(() => loadConfigFromEnv()).toThrow(
        'CORS_ORIGINS wildcard (*) is not allowed in production',
      );
    });

    it('should use default secure origins when CORS_ORIGINS not set', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'https://example.com';
      delete process.env.CORS_ORIGINS;

      const config = loadConfigFromEnv();
      expect(config.cors.allowedOrigins).toEqual([
        'https://app.super-productivity.com',
        /^https:\/\/[a-zA-Z0-9-]+\.super-productivity-preview\.pages\.dev$/,
      ]);
    });
  });

  describe('HTML Escape Function (XSS Prevention)', () => {
    it('should escape HTML special characters in privacy template', async () => {
      const { escapeHtml } = await import('../src/server');
      const escaped = escapeHtml(`<img src=x onerror="alert('xss')"> & text`);

      expect(escaped).toBe(
        '&lt;img src=x onerror=&quot;alert(&#039;xss&#039;)&quot;&gt; &amp; text',
      );
      expect(escaped).not.toContain('<img');
      expect(escaped).not.toContain('"alert');
    });
  });

  describe('Content Security Policy', () => {
    it('should have CSP enabled in helmet configuration', async () => {
      const { SERVER_HELMET_CONFIG } = await import('../src/server');

      expect(SERVER_HELMET_CONFIG.contentSecurityPolicy).toEqual({
        directives: expect.objectContaining({
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        }),
      });
    });
  });

  describe('HTTPS Enforcement in Production', () => {
    it('should reject non-HTTPS PUBLIC_URL in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'http://example.com';
      process.env.CORS_ORIGINS = 'https://app.example.com';

      expect(() => loadConfigFromEnv()).toThrow(
        'PUBLIC_URL must use HTTPS in production',
      );
    });

    it('should allow HTTP PUBLIC_URL in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.PUBLIC_URL = 'http://localhost:1900';

      const config = loadConfigFromEnv();
      expect(config.publicUrl).toBe('http://localhost:1900');
    });
  });

  describe('Test Mode Security', () => {
    it('should reject TEST_MODE in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'https://example.com';
      process.env.CORS_ORIGINS = 'https://app.example.com';
      process.env.TEST_MODE = 'true';
      process.env.TEST_MODE_CONFIRM = 'yes-i-understand-the-risks';

      expect(() => loadConfigFromEnv()).toThrow(
        'TEST_MODE cannot be enabled in production',
      );
    });

    it('should require confirmation for TEST_MODE', () => {
      process.env.NODE_ENV = 'development';
      process.env.TEST_MODE = 'true';
      // Missing TEST_MODE_CONFIRM

      expect(() => loadConfigFromEnv()).toThrow(
        'TEST_MODE requires TEST_MODE_CONFIRM=yes-i-understand-the-risks',
      );
    });

    it('should allow TEST_MODE with proper confirmation in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.TEST_MODE = 'true';
      process.env.TEST_MODE_CONFIRM = 'yes-i-understand-the-risks';

      const config = loadConfigFromEnv();
      expect(config.testMode?.enabled).toBe(true);
    });
  });
});
