import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  escapeHtml,
  sanitizeRequestUrlForLog,
  SERVER_HELMET_CONFIG,
  SERVER_TRUST_PROXY,
} from '../src/server';

const currentDir = dirname(fileURLToPath(import.meta.url));

const extractCaddyBlock = (caddyfile: string, openingPattern: RegExp): string => {
  const opening = openingPattern.exec(caddyfile);
  if (!opening) {
    throw new Error(`Missing Caddy block: ${openingPattern}`);
  }

  const openingBrace = caddyfile.indexOf('{', opening.index);
  let depth = 0;
  for (let index = openingBrace; index < caddyfile.length; index++) {
    if (caddyfile[index] === '{') {
      depth++;
    } else if (caddyfile[index] === '}') {
      depth--;
      if (depth === 0) {
        return caddyfile.slice(opening.index, index + 1);
      }
    }
  }

  throw new Error(`Unclosed Caddy block: ${openingPattern}`);
};

const getCaddyLogBlocks = (): { runtime: string; access: string } => {
  const caddyfile = readFileSync(join(currentDir, '../Caddyfile'), 'utf8');
  const activeCaddyfile = caddyfile.replace(/#.*$/gm, '');

  return {
    runtime: extractCaddyBlock(activeCaddyfile, /^ {4}log default\s*\{/m),
    access: extractCaddyBlock(activeCaddyfile, /^ {4}log\s*\{/m),
  };
};

describe('Server Security Configuration', () => {
  describe('request log sanitization', () => {
    it('should omit every query value from application error logs', () => {
      expect(
        sanitizeRequestUrlForLog(
          '/api/sync/ws?token=secret-jwt&clientId=B_AEh6&limit=10',
        ),
      ).toBe('/api/sync/ws?redacted');
    });

    it('should omit encoded, mixed-case, and alternate secret names', () => {
      expect(
        sanitizeRequestUrlForLog(
          '/api/login?access%5Ftoken=secret&ToKeN=other&ApiKey=third',
        ),
      ).toBe('/api/login?redacted');
    });

    it('should omit query strings from both access logs and proxy error logs', () => {
      const logBlocks = getCaddyLogBlocks();

      expect(logBlocks.runtime).toContain('request>uri regexp "[?].*$" "?REDACTED"');
      expect(logBlocks.access).toContain('request>uri regexp "[?].*$" "?REDACTED"');
      expect(logBlocks.runtime).toContain('wrap json');
      expect(logBlocks.access).toContain('wrap console');
    });

    it('should prevent token-bearing page URLs from reaching proxy logs as referrers', () => {
      const caddyfile = readFileSync(join(currentDir, '../Caddyfile'), 'utf8');
      const activeCaddyfile = caddyfile.replace(/#.*$/gm, '');

      expect(activeCaddyfile).toMatch(/Referrer-Policy\s+no-referrer/);
      const logBlocks = getCaddyLogBlocks();
      expect(logBlocks.runtime).toMatch(/request>headers>Referer\s+delete/);
      expect(logBlocks.access).toMatch(/request>headers>Referer\s+delete/);
    });
  });

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
      await app.register(helmet, SERVER_HELMET_CONFIG);

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

    it('should prevent token-bearing page URLs from being sent as referrers', async () => {
      await app.register(helmet, SERVER_HELMET_CONFIG);
      app.get('/test', async () => ({ status: 'ok' }));
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });
  });

  describe('HTML Escape Function', () => {
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

  // Pins the trustProxy contract: req.ip is the @fastify/rate-limit key, so if a
  // dependency bump silently changes which peers are trusted, every client either
  // collapses into one rate-limit bucket or gains the ability to spoof its IP.
  // fastify 5.12.1 disabled the previous `trustProxy: 1` this way (GHSA-3m5p-2c4r-xxw2).
  describe('trusted proxy configuration', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = Fastify({ trustProxy: SERVER_TRUST_PROXY });
      app.get('/test', async (req) => ({ ip: req.ip }));
      await app.ready();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    const getIpForPeer = async (remoteAddress: string): Promise<string> => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        remoteAddress,
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      return (JSON.parse(response.body) as { ip: string }).ip;
    };

    // Every place the reverse proxy can sit: loopback for host networking or a
    // same-pod sidecar, 172.16/12 for the docker bridge, 10/8 for a k8s pod
    // network, 192.168/16 for a bare-metal LAN.
    it.each(['127.0.0.1', '::1', '172.17.0.1', '10.42.0.7', '192.168.1.10'])(
      'should resolve the forwarded client IP for proxy at %s',
      async (remoteAddress) => {
        expect(await getIpForPeer(remoteAddress)).toBe('203.0.113.9');
      },
    );

    it('should ignore X-Forwarded-For from a peer outside the trusted ranges', async () => {
      // A client reaching the origin directly must not be able to spoof its IP.
      expect(await getIpForPeer('203.0.113.7')).toBe('203.0.113.7');
    });

    it('should not use the hop-count form disabled by GHSA-3m5p-2c4r-xxw2', () => {
      expect(typeof SERVER_TRUST_PROXY).not.toBe('number');
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

  it('should escape malicious token in data attribute', async () => {
    const { pageRoutes } = await import('../src/pages');

    app = Fastify();
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();

    // Test attribute breakout attempt - double quotes should be escaped
    const maliciousToken = '"><script>alert(1)</script>';
    const response = await app.inject({
      method: 'GET',
      url: `/reset-password?token=${encodeURIComponent(maliciousToken)}`,
    });

    expect(response.statusCode).toBe(200);
    const html = response.body;

    // Token is in data-token attribute, escapeHtml prevents attribute breakout
    expect(html).toContain('data-token="');
    // The raw attack string should not appear unescaped
    expect(html).not.toContain('"><script>');
    // Double quotes are escaped as &quot;
    expect(html).toContain('&quot;');
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

    // escapeHtml escapes < as &lt; to prevent injection
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('&lt;'); // < escaped as HTML entity
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

describe('CORS with wildcard origins', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should allow requests from subdomain matching wildcard pattern', async () => {
    const cors = await import('@fastify/cors');

    app = Fastify();
    await app.register(cors.default, {
      origin: [/^https:\/\/[^\/]+\.preview\.example\.com$/],
      methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
    });

    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://abc123.preview.example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBe(
      'https://abc123.preview.example.com',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('should reject requests from non-matching origin', async () => {
    const cors = await import('@fastify/cors');

    app = Fastify();
    await app.register(cors.default, {
      origin: [/^https:\/\/[^\/]+\.preview\.example\.com$/],
      methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
    });

    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://evil.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('should allow multiple wildcard patterns', async () => {
    const cors = await import('@fastify/cors');

    app = Fastify();
    await app.register(cors.default, {
      origin: [
        /^https:\/\/[^\/]+\.preview\.example\.com$/,
        /^https:\/\/[^\/]+\.staging\.example\.com$/,
      ],
      methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
    });

    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    // Test first pattern
    const response1 = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://feature-123.preview.example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response1.headers['access-control-allow-origin']).toBe(
      'https://feature-123.preview.example.com',
    );

    // Test second pattern
    const response2 = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://test.staging.example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response2.headers['access-control-allow-origin']).toBe(
      'https://test.staging.example.com',
    );
  });

  it('should work with mixed string and RegExp origins', async () => {
    const cors = await import('@fastify/cors');

    app = Fastify();
    await app.register(cors.default, {
      origin: ['https://app.example.com', /^https:\/\/[^\/]+\.preview\.example\.com$/],
      methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
    });

    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    // Test string origin
    const response1 = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response1.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );

    // Test RegExp origin
    const response2 = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://pr-456.preview.example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response2.headers['access-control-allow-origin']).toBe(
      'https://pr-456.preview.example.com',
    );
  });
});
