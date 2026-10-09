import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findPendingMigrations,
  listShippedMigrations,
  warnOnPendingMigrations,
} from '../src/migration-status';
import { Logger } from '../src/logger';

const REAL_MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

const dbReturning = (names: string[]) => ({
  $queryRaw: vi
    .fn()
    .mockResolvedValue(names.map((migration_name) => ({ migration_name }))),
});

describe('migration status', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('lists only directories that contain a migration.sql', () => {
    const names = listShippedMigrations(REAL_MIGRATIONS_DIR);
    expect(names).toContain('0_init');
    expect(names).not.toContain('migration_lock.toml');
    expect(names).not.toContain('README.md');
    expect(names.every((name) => !name.endsWith('.ts'))).toBe(true);
  });

  it('returns no migrations when the directory is missing', () => {
    expect(listShippedMigrations(path.join(tmpDir, 'absent'))).toEqual([]);
  });

  it('finds shipped migrations that are not applied', () => {
    expect(findPendingMigrations(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });

  it('logs nothing when every shipped migration is applied', async () => {
    await warnOnPendingMigrations(
      dbReturning(listShippedMigrations(REAL_MIGRATIONS_DIR)),
      REAL_MIGRATIONS_DIR,
    );
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it('names the missing migrations', async () => {
    const shipped = listShippedMigrations(REAL_MIGRATIONS_DIR);
    const last = shipped[shipped.length - 1];

    await warnOnPendingMigrations(dbReturning(shipped.slice(0, -1)), REAL_MIGRATIONS_DIR);

    expect(Logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Logger.error).mock.calls[0][0]).toContain(last);
  });

  it('warns instead of throwing when the migrations table is unreadable', async () => {
    const db = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('relation does not exist')),
    };

    await expect(
      warnOnPendingMigrations(db, REAL_MIGRATIONS_DIR),
    ).resolves.toBeUndefined();
    expect(Logger.warn).toHaveBeenCalledTimes(1);
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it('skips the check when no migrations are shipped', async () => {
    const db = dbReturning([]);
    await warnOnPendingMigrations(db, tmpDir);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
