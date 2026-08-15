// Must precede the DATABASE_URL read below: PrismaClient loads `.env` from
// inside its constructor, i.e. too late for the connection-string override.
// Same entry point the server itself uses (src/index.ts).
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Session name every monitoring connection advertises.
 *
 * `health-alert.sh` pages when any query outruns `MAX_QUERY_SECONDS` (default
 * 120s) and picks the sessions it may ignore by `application_name`. A monitoring
 * report is now *expected* to outrun that budget, so without this name a routine
 * `monitor:all` would alert the operator about its own tooling. The matching
 * exclusion sits beside the migrator's in that script's `pool_sessions` CTE —
 * change one and you must change the other.
 */
export const MONITORING_APPLICATION_NAME = 'supersync-monitor';

const STATEMENT_TIMEOUT_ENV = 'MONITOR_STATEMENT_TIMEOUT_MS';
const DEFAULT_STATEMENT_TIMEOUT_MS = 300_000;
/** `statement_timeout` is an int GUC; past this PostgreSQL rejects the connection. */
const MAX_STATEMENT_TIMEOUT_MS = 2_147_483_647;

/**
 * How long a single monitoring statement may run.
 *
 * An environment variable for the same reason as `MONITOR_SCOPE_USERS`:
 * `run-all-monitoring` builds every child command line itself and forwards no
 * per-report flags, but does pass `{...process.env}` down.
 */
export const monitoringStatementTimeoutMs = (): number => {
  const raw = process.env[STATEMENT_TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_STATEMENT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  // A rejected value must never reach the connection string. PostgreSQL refuses
  // the connection outright for a non-numeric `statement_timeout`, which would
  // read as "the database is down" rather than "this variable is a typo"; `0`
  // disables the timeout altogether, restoring the unbounded query that held a
  // pool connection for 75 minutes in the 2026-07-20 outage; and the GUC is an
  // int, so anything past INT_MAX is rejected by the server the same way a typo
  // is -- catching it here is what keeps that distinction visible.
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_STATEMENT_TIMEOUT_MS ||
    String(parsed) !== raw.trim()
  ) {
    throw new Error(
      `${STATEMENT_TIMEOUT_ENV} must be a positive integer of milliseconds ` +
        `no greater than ${MAX_STATEMENT_TIMEOUT_MS}, got "${raw}". ` +
        `Omit it to use the default of ${DEFAULT_STATEMENT_TIMEOUT_MS}.`,
    );
  }
  return parsed;
};

/**
 * `rawUrl` re-pointed at the monitoring workload: its own statement timeout and
 * an identifiable session name.
 *
 * The operator's `DATABASE_URL` carries a timeout sized for the sync request
 * path (env.example documents 60s), where a slow query means a user is waiting
 * and pool exhaustion is the failure to avoid. Fleet-wide analysis is the
 * opposite trade: it runs from a shell, holds one connection, and a report that
 * legitimately needs two minutes should produce numbers rather than a cancel.
 * Sharing one budget across both means either the app tolerates 5-minute
 * queries or the reports cannot finish — so monitoring overrides it per session.
 *
 * Appending rather than replacing is what performs the override: libpq applies
 * repeated `-c` settings left to right, so the last `statement_timeout` wins and
 * any other `options` the operator set survive. `URLSearchParams` serialises
 * spaces as `+`, which PostgreSQL does not decode inside `options`, so the
 * `%20` rewrite is required rather than cosmetic — the same encoding rule
 * env.example calls out. Mirrors `scripts/migrate-deploy.sh`.
 */
export const monitoringDatabaseUrl = (rawUrl: string, timeoutMs: number): string => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Naming the variable is the whole point: this runs at import, before any
    // report prints, so the bare ERR_INVALID_URL it replaces surfaced as a stack
    // trace out of a monitoring script with no hint at the cause. Never fall
    // back to `rawUrl` -- that would silently drop the override and restore the
    // request-path timeout this module exists to escape.
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
  }
  const options = url.searchParams.getAll('options').filter(Boolean);
  options.push(`-c statement_timeout=${timeoutMs}`);
  url.searchParams.delete('options');
  url.searchParams.append('options', options.join(' '));
  url.searchParams.delete('application_name');
  url.searchParams.append('application_name', MONITORING_APPLICATION_NAME);
  url.search = url.searchParams.toString().replace(/\+/g, '%20');
  return url.toString();
};

const rawDatabaseUrl = process.env.DATABASE_URL;

// Monitoring commands report query failures themselves, so Prisma's duplicate
// client-level error logging would only add noise.
export const prisma = new PrismaClient({
  log: [],
  // Left untouched when DATABASE_URL is absent so Prisma still owns that error
  // message; unit tests import this module without a database.
  ...(rawDatabaseUrl
    ? {
        datasources: {
          db: {
            url: monitoringDatabaseUrl(rawDatabaseUrl, monitoringStatementTimeoutMs()),
          },
        },
      }
    : {}),
});

// Never let the override fail silently. PrismaClient loads `.env` into
// process.env from inside its own constructor, so on an install where the URL
// lives only in `.env` -- the setup README.md documents -- the read above sees
// `undefined`, the override is skipped, and Prisma then connects anyway using
// the URL it loaded itself. Monitoring would run under the request-path timeout
// with no application_name and print nothing to say so: a fix that never fires
// (#9045). Importing dotenv first closes the common case; warning covers the
// rest, because a report that quietly kept the 60s budget is the failure this
// module exists to prevent.
if (!rawDatabaseUrl) {
  console.warn(
    'WARNING: DATABASE_URL was not set in the environment, so monitoring could not ' +
      'apply its own statement_timeout or application_name. Reports run under the ' +
      "deployment's timeout and are invisible to health-alert.sh.",
  );
}

export const disconnectDb = async (): Promise<void> => {
  await prisma.$disconnect();
};

export const isPrismaStatementTimeout = (error: unknown): boolean => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010'
  ) {
    return false;
  }

  const meta = error.meta;
  return (
    meta?.code === '57014' &&
    typeof meta.message === 'string' &&
    meta.message.includes('canceling statement due to statement timeout')
  );
};

export const reportMonitoringError = (
  message: string,
  error: unknown,
  logger: (message: string, error?: unknown) => void = console.error,
): void => {
  if (isPrismaStatementTimeout(error)) {
    logger(
      `${message} PostgreSQL canceled this query because it exceeded statement_timeout.`,
    );
    return;
  }

  logger(message, error);
};
