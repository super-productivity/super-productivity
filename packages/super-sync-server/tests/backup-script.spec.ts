import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const BACKUP_SCRIPT = join(currentDir, '../scripts/backup.sh');

// pg_dump runs inside the container via `docker exec … pg_dump [args]`, so faking the
// docker binary on PATH fakes the dump. The accounts dump is the invocation carrying
// --table flags; the full dump carries none. A non-zero FAKE_FULL_DUMP_EXIT reproduces
// the #9836 failure shape: partial output already written, then the server dies —
// gzip still finalizes a VALID archive, so only the script's own handling can prevent
// a plausible-looking truncated backup.
const FAKE_DOCKER = `#!/bin/sh
set -u
case "$*" in
  *--table=*)
    printf 'accounts data\\n'
    ;;
  *)
    printf 'partial full dump data\\n'
    exit "\${FAKE_FULL_DUMP_EXIT:-0}"
    ;;
esac
`;

describe('backup.sh', () => {
  let workDir: string;
  let backupDir: string;

  const run = (env: Record<string, string> = {}) => {
    const binDir = join(workDir, 'bin');
    return spawnSync('bash', [BACKUP_SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DIR: backupDir,
        ...env,
      },
    });
  };

  const backupFiles = (): string[] => readdirSync(backupDir).sort();

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'backup-spec-'));
    backupDir = join(workDir, 'backups');
    const binDir = join(workDir, 'bin');
    mkdirSync(binDir);
    const fakeDocker = join(binDir, 'docker');
    writeFileSync(fakeDocker, FAKE_DOCKER);
    chmodSync(fakeDocker, 0o755);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('writes both dumps, leaves no temp files, and keeps them private', () => {
    const result = run();

    expect(result.status).toBe(0);
    const files = backupFiles();
    expect(files).toHaveLength(2);
    expect(files.some((f) => /^supersync_\d{8}_\d{6}\.sql\.gz$/.test(f))).toBe(true);
    expect(files.some((f) => /^supersync_accounts_\d{8}_\d{6}\.sql\.gz$/.test(f))).toBe(
      true,
    );
    for (const f of files) {
      // umask 077: dumps carry password hashes and passkey credentials.
      expect(statSync(join(backupDir, f)).mode & 0o777).toBe(0o600);
    }
  });

  it('leaves NO full-dump file when pg_dump dies mid-stream, but keeps the accounts dump', () => {
    const result = run({ FAKE_FULL_DUMP_EXIT: '1' });

    expect(result.status).not.toBe(0);
    const files = backupFiles();
    // The truncated-but-valid-gzip artifact must not exist under any name — final or temp.
    expect(files.filter((f) => !f.includes('accounts'))).toEqual([]);
    // The accounts dump runs FIRST precisely so a crash during the long full dump
    // cannot take the disaster-recovery artifact with it.
    expect(files.filter((f) => f.includes('accounts'))).toHaveLength(1);
    expect(files.every((f) => f.endsWith('.sql.gz'))).toBe(true);
  });

  it('sweeps stale .tmp partials but never a recent one (possibly a live dump)', () => {
    mkdirSync(backupDir, { recursive: true });
    const stale = join(backupDir, 'supersync_20200101_000000.sql.gz.tmp');
    writeFileSync(stale, 'orphan from a SIGKILLed run');
    const staleTime = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, staleTime, staleTime);
    const fresh = join(backupDir, 'supersync_20200101_000001.sql.gz.tmp');
    writeFileSync(fresh, 'in-flight dump of a concurrent run');

    const result = run();

    expect(result.status).toBe(0);
    const tmpFiles = backupFiles().filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toEqual(['supersync_20200101_000001.sql.gz.tmp']);
  });
});
