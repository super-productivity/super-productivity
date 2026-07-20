/**
 * Runs the exact JavaScript embedded in health-alert.sh against PostgreSQL.
 * This preserves coverage for Prisma result conversion, catalog permissions,
 * and the two monitoring queries without duplicating their SQL in the test.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(currentDir, '../..');
const healthScript = join(packageDir, 'scripts/health-alert.sh');

describeWithDb('health-alert.sh PostgreSQL probe', () => {
  it('executes through Prisma and returns the complete monitor result', () => {
    const script = readFileSync(healthScript, 'utf8');
    const match = script.match(/DB_PROBE_JS=\$\(cat <<'NODE'\n([\s\S]*?)\nNODE\n\)/);
    expect(match).not.toBeNull();

    const url = new URL(DATABASE_URL as string);
    url.searchParams.set('connection_limit', '4');
    const result = spawnSync(process.execPath, ['-e', match?.[1] ?? ''], {
      cwd: packageDir,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        HEALTH_MAX_QUERY_SECONDS: '120',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^POOL_LIMIT=4$/m);
    expect(result.stdout).toMatch(/^LONG_Q=\d+$/m);
    expect(result.stdout).toMatch(/^LONGEST=\d+$/m);
    expect(result.stdout).toMatch(/^ACTIVE=\d+$/m);
    expect(result.stdout).toMatch(/^BAD_INDEX=.*$/m);
  });
});
