/**
 * Proves migrate-deploy.sh's orphaned-CONCURRENTLY cleanup against a REAL
 * PostgreSQL: an interrupted prior deploy can leave a `CREATE INDEX
 * CONCURRENTLY` backend running (Postgres does not notice the client
 * disconnected mid-statement), still holding the table lock, which then wedges
 * the recovery's out-of-band DROP. The cleanup must terminate exactly that
 * orphan and nothing else.
 *
 * The sibling unit spec drives a FAKE `npx prisma` and asserts the termination
 * SQL is issued with the right predicate. Only this spec proves that predicate
 * actually matches real `pg_stat_activity` rows and that `pg_terminate_backend`
 * really kills the orphan while sparing every session it must not touch:
 *   - an idle migrator session (state filter),
 *   - a non-migrator session (application_name prefix filter),
 *   - THIS run's own migrator session (application_name <> current),
 *   - a migrator build in another database on the cluster (datname filter).
 *
 * It exercises the `--terminate-orphaned-concurrently` seam so the targeting can
 * be asserted deterministically, without provoking a full concurrent index
 * build (which would additionally block on the spared sleepers' open snapshots).
 *
 * It also proves the recovery serialization of #9781: while a peer holds the
 * dedicated recovery advisory lock (72707370), the cleanup must refuse to
 * terminate anything (the "orphan" may be that peer's LIVE build) — and must
 * release the lock it takes for itself once done.
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(currentDir, '../..');
const migrateScript = join(packageDir, 'scripts/migrate-deploy.sh');

// A shared substring in every backend's query text, so cleanup can find and
// terminate any leftover sleeper regardless of its application_name.
const MARKER_PREFIX = 'orphan_cleanup_';

const urlWithAppName = (appName: string): string => {
  const url = new URL(DATABASE_URL as string);
  url.searchParams.set('application_name', appName);
  return url.toString();
};

// The dedicated recovery advisory lock of migrate-deploy.sh (#9781), distinct
// from Prisma's own migrate lock 72707369.
const RECOVERY_LOCK_KEY = 72707370;

// Session-level advisory locks live and die with one session, so a client that
// takes or probes the lock must pin the pool to a single connection.
const singleConnectionClient = (appName: string): PrismaClient => {
  const url = new URL(DATABASE_URL as string);
  url.searchParams.set('application_name', appName);
  url.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
};

interface Backend {
  application_name: string;
  state: string;
  pid: number;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describeWithDb(
  'migrate-deploy.sh orphaned CONCURRENTLY cleanup (real PostgreSQL)',
  () => {
    let admin: PrismaClient;
    const clients: PrismaClient[] = [];
    const otherDbs: string[] = [];

    const runCleanup = (env: Record<string, string> = {}): ReturnType<typeof spawnSync> =>
      spawnSync('sh', [migrateScript, '--terminate-orphaned-concurrently'], {
        cwd: packageDir,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          DATABASE_URL: DATABASE_URL as string,
          MIGRATE_STEP_TIMEOUT: '20',
          ...env,
        },
      });

    const activityFor = (marker: string): Promise<Backend[]> =>
      admin.$queryRawUnsafe<Backend[]>(
        `SELECT application_name, state, pid
         FROM pg_stat_activity
        WHERE query LIKE $1 AND pid <> pg_backend_pid()`,
        `%${marker}%`,
      );

    // A backend whose pg_stat_activity.query text contains "CONCURRENTLY" — a
    // comment is enough, since the cleanup keys on the query text exactly as it
    // would see a real `CREATE INDEX CONCURRENTLY`.
    const spawnActiveUrl = (url: string, marker: string): void => {
      const client = new PrismaClient({ datasources: { db: { url } } });
      clients.push(client);
      // Fire-and-forget: the sleep stays ACTIVE until the cleanup (or afterEach)
      // terminates it, at which point the promise rejects and is swallowed.
      void client
        .$queryRawUnsafe(`SELECT pg_sleep(60) /* CREATE INDEX CONCURRENTLY ${marker} */`)
        .catch(() => {});
    };

    const spawnActive = (appName: string, marker: string): void =>
      spawnActiveUrl(urlWithAppName(appName), marker);

    const spawnIdle = async (appName: string, marker: string): Promise<void> => {
      const client = new PrismaClient({
        datasources: { db: { url: urlWithAppName(appName) } },
      });
      clients.push(client);
      // Completes immediately, so the session goes IDLE with the CONCURRENTLY
      // marker still showing in pg_stat_activity.query — the exact false-positive
      // the state filter must reject.
      await client.$queryRawUnsafe(`SELECT 1 /* CREATE INDEX CONCURRENTLY ${marker} */`);
    };

    const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
      for (let i = 0; i < 100; i++) {
        if (await predicate()) return;
        await delay(100);
      }
      throw new Error('timed out waiting for expected pg_stat_activity state');
    };

    beforeAll(() => {
      admin = new PrismaClient({
        datasources: { db: { url: urlWithAppName('supersync-orphan-cleanup-admin') } },
      });
    });

    afterEach(async () => {
      await admin
        .$queryRawUnsafe(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE query LIKE $1 AND pid <> pg_backend_pid()`,
          `%${MARKER_PREFIX}%`,
        )
        .catch(() => {});
      await Promise.all(clients.map((c) => c.$disconnect().catch(() => {})));
      clients.length = 0;
      for (const db of otherDbs) {
        await admin
          .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)
          .catch(() => {});
      }
      otherDbs.length = 0;
    });

    afterAll(async () => {
      await admin.$disconnect();
    });

    it('terminates an active migrator-owned CONCURRENTLY orphan, sparing others', async () => {
      const marker = `${MARKER_PREFIX}${randomUUID().replace(/-/g, '')}`;
      const orphanApp = `supersync-migrator-${randomUUID()}`; // active + migrator  -> killed
      const idleApp = `supersync-migrator-${randomUUID()}`; //   idle  + migrator  -> spared
      const foreignApp = `supersync-orphan-foreign-${randomUUID()}`; // active, not migrator -> spared

      spawnActive(orphanApp, marker);
      spawnActive(foreignApp, marker);
      await spawnIdle(idleApp, marker);

      await waitUntil(async () => {
        const byApp = new Map(
          (await activityFor(marker)).map((r) => [r.application_name, r.state]),
        );
        return (
          byApp.get(orphanApp) === 'active' &&
          byApp.get(foreignApp) === 'active' &&
          byApp.get(idleApp) === 'idle'
        );
      });

      const res = spawnSync('sh', [migrateScript, '--terminate-orphaned-concurrently'], {
        cwd: packageDir,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          DATABASE_URL: DATABASE_URL as string,
          MIGRATE_STEP_TIMEOUT: '20',
        },
      });
      expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);

      await waitUntil(async () => {
        const apps = (await activityFor(marker)).map((r) => r.application_name);
        return !apps.includes(orphanApp);
      });

      const remaining = (await activityFor(marker)).map((r) => r.application_name);
      expect(remaining).not.toContain(orphanApp); // active migrator build: terminated
      expect(remaining).toContain(foreignApp); // wrong application_name prefix: spared
      expect(remaining).toContain(idleApp); // idle (not actively building): spared
    }, 60_000);

    it("spares the current run's own migrator session (application_name <> current)", async () => {
      // The cleanup connects as MIGRATOR_APPLICATION_NAME and excludes it, so a
      // build owned by THIS run must survive while a different run's orphan dies.
      const marker = `${MARKER_PREFIX}${randomUUID().replace(/-/g, '')}`;
      const currentApp = `supersync-migrator-${randomUUID()}`; // this run -> spared
      const orphanApp = `supersync-migrator-${randomUUID()}`; // other run -> killed

      spawnActive(currentApp, marker);
      spawnActive(orphanApp, marker);

      await waitUntil(async () => {
        const byApp = new Map(
          (await activityFor(marker)).map((r) => [r.application_name, r.state]),
        );
        return byApp.get(currentApp) === 'active' && byApp.get(orphanApp) === 'active';
      });

      const res = runCleanup({ MIGRATOR_APPLICATION_NAME: currentApp });
      expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);

      await waitUntil(
        async () =>
          !(await activityFor(marker)).map((r) => r.application_name).includes(orphanApp),
      );

      const remaining = (await activityFor(marker)).map((r) => r.application_name);
      expect(remaining).toContain(currentApp); // our own run's identity: spared
      expect(remaining).not.toContain(orphanApp); // a different run's orphan: terminated
    }, 60_000);

    it('does not touch a migrator build in another database (datname filter)', async () => {
      // Same-role, same application_name shape, ACTIVE CONCURRENTLY build — but in
      // a different database on the same cluster. datname = current_database()
      // must spare it, so a shared cluster's sibling environment is never hit.
      const marker = `${MARKER_PREFIX}${randomUUID().replace(/-/g, '')}`;
      const otherDb = `orphan_other_${randomUUID().replace(/-/g, '')}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${otherDb}"`);
      otherDbs.push(otherDb);

      const otherUrl = new URL(DATABASE_URL as string);
      otherUrl.pathname = `/${otherDb}`;
      const foreignDbApp = `supersync-migrator-${randomUUID()}`;
      otherUrl.searchParams.set('application_name', foreignDbApp);
      spawnActiveUrl(otherUrl.toString(), marker); // other DB -> spared

      const orphanApp = `supersync-migrator-${randomUUID()}`; // current DB -> killed
      spawnActive(orphanApp, marker);

      await waitUntil(async () => {
        const byApp = new Map(
          (await activityFor(marker)).map((r) => [r.application_name, r.state]),
        );
        return byApp.get(foreignDbApp) === 'active' && byApp.get(orphanApp) === 'active';
      });

      const res = runCleanup();
      expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);

      await waitUntil(
        async () =>
          !(await activityFor(marker)).map((r) => r.application_name).includes(orphanApp),
      );

      const remaining = (await activityFor(marker)).map((r) => r.application_name);
      expect(remaining).toContain(foreignDbApp); // other database: spared
      expect(remaining).not.toContain(orphanApp); // current database: terminated
    }, 60_000);

    it('refuses to kill anything while a peer holds the recovery lock, then proceeds once released', async () => {
      // #9781: without serialization the cleanup would treat a peer recovery's
      // LIVE build as an orphan and pg_terminate_backend it. This test fails
      // against the pre-lock script (which killed the session and exited 0).
      const marker = `${MARKER_PREFIX}${randomUUID().replace(/-/g, '')}`;
      const orphanApp = `supersync-migrator-${randomUUID()}`;

      const holder = singleConnectionClient('supersync-orphan-lock-holder');
      clients.push(holder);
      const held = await holder.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_lock(${RECOVERY_LOCK_KEY}) AS locked`,
      );
      expect(held[0].locked).toBe(true);

      spawnActive(orphanApp, marker);
      await waitUntil(async () => {
        const byApp = new Map(
          (await activityFor(marker)).map((r) => [r.application_name, r.state]),
        );
        return byApp.get(orphanApp) === 'active';
      });

      const blocked = runCleanup({ MIGRATE_RECOVERY_LOCK_TIMEOUT: '2' });
      expect(blocked.status, `${blocked.stdout}${blocked.stderr}`).not.toBe(0);
      expect(`${blocked.stdout}${blocked.stderr}`).toContain('recovery advisory lock');

      // From the locked peer's perspective this session is a LIVE build: spared.
      const survivors = (await activityFor(marker)).map((r) => r.application_name);
      expect(survivors).toContain(orphanApp);

      await holder.$queryRawUnsafe(`SELECT pg_advisory_unlock(${RECOVERY_LOCK_KEY})`);

      const unblocked = runCleanup();
      expect(unblocked.status, `${unblocked.stdout}${unblocked.stderr}`).toBe(0);
      await waitUntil(
        async () =>
          !(await activityFor(marker)).map((r) => r.application_name).includes(orphanApp),
      );
    }, 60_000);

    it('releases the recovery lock when the cleanup finishes', async () => {
      const res = runCleanup();
      expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);

      const probe = singleConnectionClient('supersync-orphan-lock-probe');
      clients.push(probe);
      const rows = await probe.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_lock(${RECOVERY_LOCK_KEY}) AS locked`,
      );
      expect(rows[0].locked).toBe(true); // free again — the seam's holder is gone
      await probe.$queryRawUnsafe(`SELECT pg_advisory_unlock(${RECOVERY_LOCK_KEY})`);
    }, 60_000);
  },
);
