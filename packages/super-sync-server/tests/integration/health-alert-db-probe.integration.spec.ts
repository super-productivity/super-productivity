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

const runProbe = (databaseUrl: string) =>
  spawnSync(process.execPath, ['-e', embeddedProbe()], {
    cwd: packageDir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      HEALTH_MAX_QUERY_SECONDS: '120',
    },
  });

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
    expect(result.stdout).toMatch(/^ACTIVE=\d+$/m);
    expect(result.stdout).toMatch(/^BAD_INDEX=.*$/m);
  });

  it('checks the operations table selected by the Prisma schema parameter', async () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const schema = `health_probe_${suffix}`;
    const index = `health_probe_invalid_${suffix}`;
    const admin = new PrismaClient({
      datasources: { db: { url: DATABASE_URL as string } },
    });

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

      const url = new URL(DATABASE_URL as string);
      url.searchParams.set('schema', schema);
      url.searchParams.set('connection_limit', '4');
      const result = runProbe(url.toString());

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`^BAD_INDEX=.*${index}.*$`, 'm'));
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
});
