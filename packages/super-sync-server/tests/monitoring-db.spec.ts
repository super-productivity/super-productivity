import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MONITORING_APPLICATION_NAME,
  isPrismaStatementTimeout,
  monitoringDatabaseUrl,
  monitoringStatementTimeoutMs,
  reportMonitoringError,
} from '../scripts/monitoring-db';

const BASE_URL = 'postgresql://u:p@postgres:5432/supersync?connection_limit=60';

describe('monitoring statement timeout', () => {
  const originalEnv = process.env.MONITOR_STATEMENT_TIMEOUT_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MONITOR_STATEMENT_TIMEOUT_MS;
    } else {
      process.env.MONITOR_STATEMENT_TIMEOUT_MS = originalEnv;
    }
  });

  it('defaults to a monitoring-sized budget rather than the request path budget', () => {
    delete process.env.MONITOR_STATEMENT_TIMEOUT_MS;
    expect(monitoringStatementTimeoutMs()).toBe(300_000);
  });

  it('accepts an operator override', () => {
    process.env.MONITOR_STATEMENT_TIMEOUT_MS = '600000';
    expect(monitoringStatementTimeoutMs()).toBe(600_000);
  });

  // A value that slipped through would either make PostgreSQL refuse the
  // connection (non-numeric, or past the int GUC ceiling) or disable the timeout
  // entirely (0) -- both of which read as "the database is down" at the call
  // site rather than "this variable is wrong".
  it.each(['abc', '0', '-1', '30s', '1.5', '2147483648', '99999999999'])(
    'rejects %s',
    (raw) => {
      process.env.MONITOR_STATEMENT_TIMEOUT_MS = raw;
      expect(() => monitoringStatementTimeoutMs()).toThrow(
        /MONITOR_STATEMENT_TIMEOUT_MS must be a positive integer/,
      );
    },
  );

  it('accepts the largest value PostgreSQL will take', () => {
    process.env.MONITOR_STATEMENT_TIMEOUT_MS = '2147483647';
    expect(monitoringStatementTimeoutMs()).toBe(2_147_483_647);
  });
});

describe('monitoring connection string', () => {
  it('applies the monitoring timeout and an identifiable session name', () => {
    const url = new URL(monitoringDatabaseUrl(BASE_URL, 300_000));

    expect(url.searchParams.get('options')).toBe('-c statement_timeout=300000');
    expect(url.searchParams.get('application_name')).toBe(MONITORING_APPLICATION_NAME);
  });

  // PostgreSQL does not decode `+` as a space inside `options`, so the encoding
  // is load-bearing: `+` would make the connection fail rather than the timeout
  // silently not apply.
  it('encodes spaces as %20 rather than +', () => {
    const built = monitoringDatabaseUrl(BASE_URL, 300_000);

    expect(built).toContain('statement_timeout%3D300000');
    expect(built).not.toMatch(/options=[^&]*\+/);
  });

  it('overrides the request-path timeout while keeping other options', () => {
    const built = monitoringDatabaseUrl(
      `${BASE_URL}&options=-c%20statement_timeout%3D60000%20-c%20work_mem%3D64MB`,
      300_000,
    );
    const options = new URL(built).searchParams.get('options') ?? '';

    expect(options).toContain('-c work_mem=64MB');
    // libpq applies repeated -c settings left to right, so the appended value
    // is the one that takes effect.
    expect(options.indexOf('statement_timeout=300000')).toBeGreaterThan(
      options.indexOf('statement_timeout=60000'),
    );
  });

  it('preserves unrelated connection parameters', () => {
    const url = new URL(monitoringDatabaseUrl(BASE_URL, 300_000));

    expect(url.searchParams.get('connection_limit')).toBe('60');
    expect(url.pathname).toBe('/supersync');
  });

  // The rewrite runs at import, before a report prints anything, so a bare
  // ERR_INVALID_URL surfaced as a stack trace with no hint at the cause.
  it('names DATABASE_URL when it cannot be parsed', () => {
    expect(() => monitoringDatabaseUrl('not-a-url', 300_000)).toThrow(
      /DATABASE_URL is not a valid PostgreSQL connection URL/,
    );
  });

  // Credentials live in the userinfo, which url.search never touches -- but the
  // `+` rewrite runs over the whole query string, so pin that it stays away.
  it('leaves credentials and plus-bearing values untouched', () => {
    const built = monitoringDatabaseUrl(
      'postgresql://u%2Bser:p%2Bw%40ss@postgres:5432/supersync?schema=a%2Bb',
      300_000,
    );
    const url = new URL(built);

    expect(url.username).toBe('u%2Bser');
    expect(url.password).toBe('p%2Bw%40ss');
    expect(url.searchParams.get('schema')).toBe('a+b');
  });
});

describe('monitoring errors', () => {
  it('recognizes Prisma raw queries canceled by the PostgreSQL statement timeout', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: {
        code: '57014',
        message: 'ERROR: canceling statement due to statement timeout',
      },
    });

    expect(isPrismaStatementTimeout(error)).toBe(true);
  });

  it('does not recognize other Prisma raw query failures as statement timeouts', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: {
        code: '42P01',
        message: 'relation "operations" does not exist',
      },
    });

    expect(isPrismaStatementTimeout(error)).toBe(false);
  });

  it('does not ignore PostgreSQL queries canceled for another reason', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: {
        code: '57014',
        message: 'ERROR: canceling statement due to user request',
      },
    });

    expect(isPrismaStatementTimeout(error)).toBe(false);
  });

  it('reports statement timeouts without dumping the raw Prisma error', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: {
        code: '57014',
        message: 'ERROR: canceling statement due to statement timeout',
      },
    });
    const logger = vi.fn();

    reportMonitoringError('Error:', error, logger);
    expect(logger).toHaveBeenCalledWith(
      'Error: PostgreSQL canceled this query because it exceeded statement_timeout.',
    );
    expect(logger).toHaveBeenCalledOnce();
  });

  it('continues to report genuine errors', () => {
    const error = new Error('permission denied');
    const logger = vi.fn();

    reportMonitoringError('Error:', error, logger);
    expect(logger).toHaveBeenCalledWith('Error:', error);
  });
});
