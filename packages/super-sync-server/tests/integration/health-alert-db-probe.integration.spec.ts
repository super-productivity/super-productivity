/**
 * Runs the exact JavaScript embedded in health-alert.sh against PostgreSQL.
 * This preserves coverage for Prisma result conversion, catalog permissions,
 * and the two monitoring queries without duplicating their SQL in the test.
 */
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(currentDir, '../..');
const healthScript = join(packageDir, 'scripts/health-alert.sh');
const embeddedProbe = (): string => {
  const script = readFileSync(healthScript, 'utf8');
  const match = script.match(/DB_PROBE_JS=\$\(cat <<'NODE'\n([\s\S]*?)\nNODE\n\)/);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
};

const runProbe = (databaseUrl: string, maxQuerySeconds = 120) =>
  spawnSync(process.execPath, ['-e', embeddedProbe()], {
    cwd: packageDir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      HEALTH_MAX_QUERY_SECONDS: String(maxQuerySeconds),
    },
  });

const readNumericMetric = (stdout: string, name: string): number => {
  const match = stdout.match(new RegExp(`^${name}=(\\d+)$`, 'm'));
  if (!match) throw new Error(`Missing ${name} in probe output:\n${stdout}`);
  return Number(match[1]);
};

const waitForBackend = async (
  prisma: PrismaClient,
  applicationName: string,
  expectedState: string,
): Promise<number> => {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe<Array<{ pid: number; state: string }>>(
      `SELECT pid, state
       FROM pg_stat_activity
       WHERE application_name = $1`,
      applicationName,
    );
    const backend = rows.find(({ state }) => state === expectedState);
    if (backend) return backend.pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${applicationName} to become ${expectedState}`);
};

const waitForInvalidIndex = async (
  prisma: PrismaClient,
  qualifiedIndexName: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe<Array<{ invalid: boolean }>>(
      `SELECT NOT indisvalid AS invalid
       FROM pg_index
       WHERE indexrelid = to_regclass($1)`,
      qualifiedIndexName,
    );
    if (rows.some(({ invalid }) => invalid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${qualifiedIndexName} to become invalid`);
};

describeWithDb('health-alert.sh PostgreSQL probe', () => {
  it('executes through Prisma and returns the complete monitor result', () => {
    const url = new URL(DATABASE_URL as string);
    url.searchParams.set('connection_limit', '4');
    const result = runProbe(url.toString());

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^POOL_LIMIT=4$/m);
    expect(result.stdout).toMatch(/^LONG_Q=\d+$/m);
    expect(result.stdout).toMatch(/^LONGEST=\d+$/m);
    expect(result.stdout).toMatch(/^POOL_IN_USE=\d+$/m);
    expect(result.stdout).toMatch(/^BAD_INDEX=.*$/m);
  });

  it('reports a schema-scoped invalid index during an unrelated migration', async () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const schema = `health_probe_${suffix}`;
    const index = `health_probe_invalid_${suffix}`;
    const applicationName = `supersync-migrator-test-${suffix}`;
    const migratorUrl = new URL(DATABASE_URL as string);
    migratorUrl.searchParams.set('application_name', applicationName);
    migratorUrl.searchParams.set('connection_limit', '1');
    const admin = new PrismaClient({
      datasources: { db: { url: DATABASE_URL as string } },
    });
    const migrator = new PrismaClient({
      datasources: { db: { url: migratorUrl.toString() } },
    });
    let migratorPid: number | undefined;
    let sleepQuery: Promise<unknown> | undefined;

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await admin.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."operations" ("id" integer NOT NULL)`,
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO "${schema}"."operations" ("id") VALUES (1), (1)`,
      );
      await expect(
        admin.$executeRawUnsafe(
          `CREATE UNIQUE INDEX CONCURRENTLY "${index}" ON "${schema}"."operations" ("id")`,
        ),
      ).rejects.toThrow();

      sleepQuery = migrator.$queryRawUnsafe('SELECT pg_sleep(30)').catch(() => undefined);
      migratorPid = await waitForBackend(admin, applicationName, 'active');

      const url = new URL(DATABASE_URL as string);
      url.searchParams.set('schema', schema);
      url.searchParams.set('connection_limit', '4');
      const result = runProbe(url.toString());

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`^BAD_INDEX=.*${index}.*$`, 'm'));
    } finally {
      if (migratorPid !== undefined) {
        await admin.$queryRawUnsafe('SELECT pg_cancel_backend($1::integer)', migratorPid);
      }
      await sleepQuery;
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await migrator.$disconnect();
      await admin.$disconnect();
    }
  });

  it.each([
    { expectedState: 'idle in transaction', abortTransaction: false },
    { expectedState: 'idle in transaction (aborted)', abortTransaction: true },
  ])(
    'counts a connection in $expectedState as pool usage without reporting a long query',
    async ({ expectedState, abortTransaction }) => {
      const suffix = `${process.pid}_${Date.now()}`;
      const applicationName = `health-probe-idle-${suffix}`;
      const holderUrl = new URL(DATABASE_URL as string);
      holderUrl.searchParams.set('application_name', applicationName);
      holderUrl.searchParams.set('connection_limit', '1');
      const holder = new PrismaClient({
        datasources: { db: { url: holderUrl.toString() } },
      });
      const observer = new PrismaClient({
        datasources: { db: { url: DATABASE_URL as string } },
      });
      const probeUrl = new URL(DATABASE_URL as string);
      probeUrl.searchParams.set('connection_limit', '4');
      const baseline = runProbe(probeUrl.toString(), 1);
      let releaseTransaction: () => void = () => undefined;
      let signalTransactionReady: () => void = () => undefined;
      const release = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      const transactionReady = new Promise<void>((resolve) => {
        signalTransactionReady = resolve;
      });
      const transaction = holder.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe('SELECT 1');
          if (abortTransaction) {
            await tx.$queryRawUnsafe('SELECT 1 / 0').catch(() => undefined);
          }
          signalTransactionReady();
          await release;
        },
        { timeout: 20_000 },
      );

      try {
        await Promise.race([
          transactionReady,
          transaction.then(() => {
            throw new Error('Transaction completed before it became idle');
          }),
        ]);
        await waitForBackend(observer, applicationName, expectedState);
        await new Promise((resolve) => setTimeout(resolve, 1_100));

        const result = runProbe(probeUrl.toString(), 1);

        expect(result.error).toBeUndefined();
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(readNumericMetric(result.stdout, 'POOL_IN_USE')).toBe(
          readNumericMetric(baseline.stdout, 'POOL_IN_USE') + 1,
        );
        expect(readNumericMetric(result.stdout, 'LONG_Q')).toBe(
          readNumericMetric(baseline.stdout, 'LONG_Q'),
        );
      } finally {
        releaseTransaction();
        await Promise.allSettled([transaction]);
        await Promise.allSettled([holder.$disconnect(), observer.$disconnect()]);
      }
    },
    15_000,
  );

  it('ignores only the invalid index being dropped by a migrator', async () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const schema = `health_probe_${suffix}`;
    const index = `health_probe_drop_${suffix}`;
    const qualifiedIndex = `"${schema}"."${index}"`;
    const applicationName = `supersync-migrator-test-${suffix}`;
    const migratorUrl = new URL(DATABASE_URL as string);
    migratorUrl.searchParams.set('application_name', applicationName);
    migratorUrl.searchParams.set('connection_limit', '1');
    const admin = new PrismaClient({
      datasources: { db: { url: DATABASE_URL as string } },
    });
    const blocker = new PrismaClient({
      datasources: { db: { url: DATABASE_URL as string } },
    });
    const migrator = new PrismaClient({
      datasources: { db: { url: migratorUrl.toString() } },
    });
    let releaseBlocker: () => void = () => undefined;
    let signalBlockerReady: () => void = () => undefined;
    const release = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerReady = new Promise<void>((resolve) => {
      signalBlockerReady = resolve;
    });
    let blockingTransaction: Promise<unknown> | undefined;
    let droppingIndex: Promise<unknown> | undefined;

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await admin.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."operations" ("id" integer NOT NULL)`,
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO "${schema}"."operations" ("id") SELECT generate_series(1, 100)`,
      );
      await admin.$executeRawUnsafe(
        `CREATE INDEX "${index}" ON "${schema}"."operations" ("id")`,
      );

      blockingTransaction = blocker.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
          await tx.$queryRawUnsafe(
            `SELECT "id" FROM "${schema}"."operations" WHERE "id" = 1`,
          );
          signalBlockerReady();
          await release;
        },
        { timeout: 20_000 },
      );
      await blockerReady;

      droppingIndex = migrator.$executeRawUnsafe(
        `DROP INDEX CONCURRENTLY ${qualifiedIndex}`,
      );
      await Promise.race([
        waitForBackend(admin, applicationName, 'active'),
        droppingIndex.then(() => {
          throw new Error('DROP INDEX CONCURRENTLY completed before it was observed');
        }),
      ]);
      await waitForInvalidIndex(admin, qualifiedIndex);

      const url = new URL(DATABASE_URL as string);
      url.searchParams.set('schema', schema);
      url.searchParams.set('connection_limit', '4');
      const result = runProbe(url.toString());

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(new RegExp(`^BAD_INDEX=.*${index}.*$`, 'm'));

      releaseBlocker();
      await blockingTransaction;
      await droppingIndex;
      blockingTransaction = undefined;
      droppingIndex = undefined;
    } finally {
      releaseBlocker();
      await Promise.allSettled([blockingTransaction, droppingIndex]);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await blocker.$disconnect();
      await migrator.$disconnect();
      await admin.$disconnect();
    }
  }, 20_000);
});
