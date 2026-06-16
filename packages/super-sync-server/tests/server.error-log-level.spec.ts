import { describe, it, expect, vi } from 'vitest';

// pickErrorLogLevel is a pure helper, but server.ts has top-level side
// effects on import (config load, env validation). Mock the modules it
// pulls in transitively so importing `pickErrorLogLevel` does not boot
// a real server.
vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { createListenOptions, pickErrorLogLevel } = await import('../src/server');

describe('createListenOptions', () => {
  it('passes the configured host and port to Fastify listen', () => {
    expect(createListenOptions({ port: 1900, host: '::' })).toEqual({
      port: 1900,
      host: '::',
    });
  });
});

describe('pickErrorLogLevel', () => {
  describe('5xx', () => {
    it('returns "error" for 500', () => {
      expect(pickErrorLogLevel('/anything', 500)).toBe('error');
    });
    it('returns "error" for 503', () => {
      expect(pickErrorLogLevel('/api/sync/ws', 503)).toBe('error');
    });
  });

  describe('WS-upgrade 429 (storm tail)', () => {
    it('returns "debug" for /api/sync/ws exact', () => {
      expect(pickErrorLogLevel('/api/sync/ws', 429)).toBe('debug');
    });
    it('returns "debug" for /api/sync/ws with trailing slash', () => {
      expect(pickErrorLogLevel('/api/sync/ws/', 429)).toBe('debug');
    });
    it('returns "debug" for /api/sync/ws with query string', () => {
      expect(pickErrorLogLevel('/api/sync/ws?token=x&clientId=y', 429)).toBe('debug');
    });
    it('returns "debug" for /api/sync/ws with trailing slash + query', () => {
      expect(pickErrorLogLevel('/api/sync/ws/?x', 429)).toBe('debug');
    });
  });

  describe('4xx that must stay loud', () => {
    it('returns "warn" for 429 on a sibling route (over-match guard)', () => {
      expect(pickErrorLogLevel('/api/sync/ws-status', 429)).toBe('warn');
    });
    it('returns "warn" for 429 on a different /api/sync route', () => {
      expect(pickErrorLogLevel('/api/sync/operations', 429)).toBe('warn');
    });
    it('returns "warn" for 401 on /api/sync/ws', () => {
      expect(pickErrorLogLevel('/api/sync/ws', 401)).toBe('warn');
    });
    it('returns "warn" for 400 on any URL', () => {
      expect(pickErrorLogLevel('/api/sync/ws', 400)).toBe('warn');
    });
  });
});
