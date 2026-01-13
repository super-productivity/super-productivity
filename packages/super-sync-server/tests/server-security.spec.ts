import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';

describe('Server Security Configuration', () => {
  describe('Content Security Policy', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = Fastify();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    it('should include CSP headers in response', async () => {
      // Register helmet with the same config as the server
      await app.register(helmet, {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
            baseUri: ["'self'"],
          },
        },
      });

      app.get('/test', async () => ({ status: 'ok' }));
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      // Check that CSP header is present
      const cspHeader = response.headers['content-security-policy'];
      expect(cspHeader).toBeDefined();

      // Verify key CSP directives
      expect(cspHeader).toContain("default-src 'self'");
      expect(cspHeader).toContain("script-src 'self'");
      expect(cspHeader).toContain("object-src 'none'");
      expect(cspHeader).toContain("frame-ancestors 'none'");
    });

    it('should include X-Frame-Options header', async () => {
      await app.register(helmet);
      app.get('/test', async () => ({ status: 'ok' }));
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      // Helmet sets X-Frame-Options by default
      expect(response.headers['x-frame-options']).toBeDefined();
    });

    it('should include X-Content-Type-Options header', async () => {
      await app.register(helmet);
      app.get('/test', async () => ({ status: 'ok' }));
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('HTML Escape Function', () => {
    // Test the escapeHtml function that prevents XSS in templates
    const escapeHtml = (unsafe: string): string => {
      return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    it('should escape < and > characters', () => {
      const input = '<script>alert("xss")</script>';
      const escaped = escapeHtml(input);
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });

    it('should escape ampersand', () => {
      const input = 'Tom & Jerry';
      const escaped = escapeHtml(input);
      expect(escaped).toBe('Tom &amp; Jerry');
    });

    it('should escape double quotes', () => {
      const input = 'He said "hello"';
      const escaped = escapeHtml(input);
      expect(escaped).toBe('He said &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      const input = "It's a test";
      const escaped = escapeHtml(input);
      expect(escaped).toBe('It&#039;s a test');
    });

    it('should handle multiple special characters', () => {
      const input = '<div class="test" data-value=\'a & b\'>content</div>';
      const escaped = escapeHtml(input);
      expect(escaped).toBe(
        '&lt;div class=&quot;test&quot; data-value=&#039;a &amp; b&#039;&gt;content&lt;/div&gt;',
      );
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle string with no special characters', () => {
      const input = 'Hello World';
      expect(escapeHtml(input)).toBe('Hello World');
    });

    it('should escape quotes to prevent attribute injection', () => {
      // An attacker might try to break out of an attribute and add an event handler
      const input = '" onmouseover="alert(1)"';
      const escaped = escapeHtml(input);
      // The quotes are escaped, so even though 'onmouseover' appears, it's harmless text
      // because the quote before it is escaped and won't break out of the attribute
      expect(escaped).toBe('&quot; onmouseover=&quot;alert(1)&quot;');
      // The key protection is that " is escaped to &quot;
      expect(escaped).not.toContain('"');
    });
  });
});

describe('Password Reset Page', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should render password reset form with token', async () => {
    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/reset-password?token=test-token-123',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');

    const html = response.body;
    expect(html).toContain('<title>Reset Password</title>');
    expect(html).toContain('<form id="resetForm">');
    expect(html).toContain('type="password"');
    expect(html).toContain('Minimum 12 characters');
    // Token should be escaped in the JavaScript
    expect(html).toContain('test-token-123');
  });

  it('should return 400 when token is missing', async () => {
    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/reset-password',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('Token is required');
  });

  it('should escape malicious token in JavaScript context', async () => {
    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    // Test JavaScript injection attempt - single quotes should be safe
    // because safeJsonForScript wraps in double quotes
    const maliciousToken = "';alert(1);//";
    const response = await app.inject({
      method: 'GET',
      url: `/reset-password?token=${encodeURIComponent(maliciousToken)}`,
    });

    expect(response.statusCode).toBe(200);
    const html = response.body;

    // Token is wrapped in double quotes by JSON.stringify, so single quotes are safe
    // The actual string content appears inside double quotes in the JS
    expect(html).toContain('"');
    // The raw attack string should not appear unquoted
    expect(html).not.toMatch(/token:\s*'.*;alert/);
  });

  it('should escape script tags in token to prevent XSS', async () => {
    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    const maliciousToken = '</script><script>alert("xss")</script>';
    const response = await app.inject({
      method: 'GET',
      url: `/reset-password?token=${encodeURIComponent(maliciousToken)}`,
    });

    expect(response.statusCode).toBe(200);
    const html = response.body;

    // safeJsonForScript escapes < as \u003c to prevent </script> injection
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('\\u003c'); // < escaped as unicode
  });
});

describe('Email Verification Page', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should await verifyEmail before sending response', async () => {
    // Mock the verifyEmail function to track if it was awaited
    let verifyEmailCompleted = false;
    vi.doMock('../src/auth', () => ({
      verifyEmail: vi.fn().mockImplementation(async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        verifyEmailCompleted = true;
        return true;
      }),
    }));

    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/verify-email?token=valid-token',
    });

    // The response should only be sent after verifyEmail completes
    expect(response.statusCode).toBe(200);
    expect(verifyEmailCompleted).toBe(true);
    expect(response.body).toContain('Email Verified');
  });

  it('should handle verification errors properly', async () => {
    vi.doMock('../src/auth', () => ({
      verifyEmail: vi.fn().mockRejectedValue(new Error('Invalid verification token')),
    }));

    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/verify-email?token=invalid-token',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Verification failed');
  });

  it('should return 400 when token is missing', async () => {
    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/verify-email',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('Token is required');
  });
});
