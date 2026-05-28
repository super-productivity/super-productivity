import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Drives scripts/migrate-deploy.sh end-to-end with a fake `npx prisma` so the
// generic CONCURRENTLY recovery logic is exercised without a real database.

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(currentDir, '../scripts/migrate-deploy.sh');

const ENCRYPTED_OPS = '20260514000000_add_encrypted_ops_partial_index';
const ENCRYPTED_OPS_SQL = `DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx";
CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx"
  ON "operations"("user_id", "server_seq")
  WHERE "is_payload_encrypted" = true;`;

const PLAIN_MIGRATION = '20260601000000_add_plain_column';
const PLAIN_SQL = `ALTER TABLE "operations" ADD COLUMN "foo" TEXT;`;

interface RunResult {
  status: number;
  stdout: string;
  executedSql: string;
  resolveApplied: string[];
  resolveRolledBack: string[];
}

let projectDir: string;
let stateDir: string;
let binDir: string;

const writeMigration = (name: string, sql: string): void => {
  const dir = join(projectDir, 'prisma', 'migrations', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'migration.sql'), sql);
};

// Fake `npx`: first arg is `prisma`. Behavior is driven by FAKE_* env vars and
// marker files under $FAKE_STATE so the deploy→recover→retry cycle is modelled.
const FAKE_NPX = `#!/bin/sh
set -eu
shift # drop "prisma"
sub="$1"; shift
state="$FAKE_STATE"
case "$sub" in
  migrate)
    action="$1"; shift
    case "$action" in
      deploy)
        for m in $FAKE_FAIL; do
          if [ ! -f "$state/applied_$m" ]; then
            case "$FAKE_CODE" in
              P3018)
                echo "Applying migration \\\`$m\\\`"
                echo "Error: P3018"
                echo "A migration failed to apply. New migrations cannot be applied before the error is recovered from."
                echo "Migration name: $m"
                echo "Database error code: 25001"
                echo "Database error:"
                echo "ERROR: DROP INDEX CONCURRENTLY cannot run inside a transaction block"
                ;;
              P3009)
                echo "Error: P3009"
                echo "migrate found failed migrations in the target database, new migrations will not be applied."
                echo "The \\\`$m\\\` migration started at 2026-05-15 failed"
                [ -n "\${FAKE_DECOY:-}" ] && echo "Applying migration \\\`\$FAKE_DECOY\\\`"
                ;;
              *)
                echo "Error: P1001"
                echo "Can't reach database server"
                ;;
            esac
            exit 1
          fi
        done
        echo "No pending migrations to apply."
        exit 0
        ;;
      resolve)
        mode="$1"; name="$2"
        if [ "$mode" = "--rolled-back" ]; then
          echo "$name" >> "$state/rolledback"
          exit "\${FAKE_ROLLEDBACK_EXIT:-0}"
        fi
        echo "$name" >> "$state/applied_list"
        [ "\${FAKE_MARK:-1}" = "1" ] && : > "$state/applied_$name"
        exit 0
        ;;
    esac
    ;;
  db)
    # db execute --schema X --stdin  (SQL on stdin)
    cat >> "$state/executed_sql"
    echo "" >> "$state/executed_sql"
    echo "---STMT---" >> "$state/executed_sql"
    exit "\${FAKE_EXEC_EXIT:-0}"
    ;;
esac
echo "fake npx: unhandled args" >&2
exit 99
`;

const run = (env: Record<string, string>): RunResult => {
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync('sh', [SCRIPT], {
      cwd: projectDir,
      encoding: 'utf8',
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        TMPDIR: stateDir,
        FAKE_STATE: stateDir,
        ...env,
      },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    status = err.status ?? 1;
    stdout = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const read = (f: string): string => {
    try {
      return readFileSync(join(stateDir, f), 'utf8');
    } catch {
      return '';
    }
  };
  return {
    status,
    stdout,
    executedSql: read('executed_sql'),
    resolveApplied: read('applied_list').split('\n').filter(Boolean),
    resolveRolledBack: read('rolledback').split('\n').filter(Boolean),
  };
};

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'sup-migproj-'));
  stateDir = mkdtempSync(join(tmpdir(), 'sup-migstate-'));
  binDir = mkdtempSync(join(tmpdir(), 'sup-migbin-'));
  mkdirSync(join(projectDir, 'prisma'), { recursive: true });
  writeFileSync(join(projectDir, 'prisma', 'schema.prisma'), '// dummy');
  const npxPath = join(binDir, 'npx');
  writeFileSync(npxPath, FAKE_NPX);
  chmodSync(npxPath, 0o755);
});

afterEach(() => {
  for (const d of [projectDir, stateDir, binDir]) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('migrate-deploy.sh generic CONCURRENTLY recovery', () => {
  it('clean deploy with no failures exits 0 and runs no recovery', () => {
    const r = run({ FAKE_FAIL: '', FAKE_CODE: 'P3018' });
    expect(r.status).toBe(0);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('recovers a P3018 transaction-block failure out-of-band, then succeeds', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({ FAKE_FAIL: ENCRYPTED_OPS, FAKE_CODE: 'P3018' });

    expect(r.status).toBe(0);
    expect(r.resolveRolledBack).toContain(ENCRYPTED_OPS);
    expect(r.resolveApplied).toContain(ENCRYPTED_OPS);
    // Both statements ran out-of-band; multi-line CREATE collapsed to one line.
    expect(r.executedSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx";',
    );
    expect(r.executedSql).toContain(
      'CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx" ON "operations"("user_id", "server_seq") WHERE "is_payload_encrypted" = true;',
    );
    const statements = r.executedSql
      .split('---STMT---')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);
  });

  it('recovers a stuck P3009 failed migration', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({ FAKE_FAIL: ENCRYPTED_OPS, FAKE_CODE: 'P3009' });
    expect(r.status).toBe(0);
    expect(r.resolveApplied).toContain(ENCRYPTED_OPS);
  });

  it('refuses to auto-resolve a non-CONCURRENTLY migration', () => {
    writeMigration(PLAIN_MIGRATION, PLAIN_SQL);
    const r = run({ FAKE_FAIL: PLAIN_MIGRATION, FAKE_CODE: 'P3018' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('refusing to auto-resolve');
    expect(r.resolveApplied).toEqual([]);
  });

  it('refuses a bare CREATE INDEX CONCURRENTLY (intentionally fail-loud, no DROP)', () => {
    const bare = '20260701000000_add_bare_concurrent_index';
    // Same shape as the committed 20260511000000: deliberately no DROP, so a
    // half-built INVALID index fails loudly instead of being marked applied.
    const bareSql = `CREATE INDEX CONCURRENTLY "operations_bare_idx"
  ON "operations"("user_id", "server_seq");`;
    writeMigration(bare, bareSql);
    const r = run({ FAKE_FAIL: bare, FAKE_CODE: 'P3018' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('not a recoverable drop-then-create');
    expect(r.resolveApplied).toEqual([]);
  });

  it('does NOT mark applied when an out-of-band statement fails', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({
      FAKE_FAIL: ENCRYPTED_OPS,
      FAKE_CODE: 'P3018',
      FAKE_EXEC_EXIT: '1',
    });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('was NOT marked applied');
    expect(r.resolveApplied).toEqual([]);
  });

  it('aborts instead of looping when recovery does not clear the failure', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({
      FAKE_FAIL: ENCRYPTED_OPS,
      FAKE_CODE: 'P3018',
      FAKE_MARK: '0', // resolve --applied never clears the marker
    });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('failed again after out-of-band recovery');
  });

  it('passes through a genuine non-gate failure without auto-resolving', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({ FAKE_FAIL: ENCRYPTED_OPS, FAKE_CODE: 'OTHER' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('Not auto-recovered');
    expect(r.resolveApplied).toEqual([]);
  });

  it('targets the failed migration in a P3009 log that also backticks others', () => {
    // A decoy backticked migration name appears AFTER the failed-migration
    // sentence; the sentence-anchored parse must still pick ENCRYPTED_OPS,
    // not the last backticked token.
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({
      FAKE_FAIL: ENCRYPTED_OPS,
      FAKE_CODE: 'P3009',
      FAKE_DECOY: '20991231000000_decoy_later_token',
    });

    expect(r.status).toBe(0);
    expect(r.resolveApplied).toContain(ENCRYPTED_OPS);
  });

  it('recovers several sequential CONCURRENTLY migrations in one deploy', () => {
    const second = '20260514000002_add_payload_bytes_unbackfilled_index';
    const secondSql = `DROP INDEX CONCURRENTLY IF EXISTS "operations_payload_bytes_unbackfilled_idx";
CREATE INDEX CONCURRENTLY "operations_payload_bytes_unbackfilled_idx"
  ON "operations"("user_id", "id")
  WHERE "payload_bytes" = 0;`;
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    writeMigration(second, secondSql);

    const r = run({
      FAKE_FAIL: `${ENCRYPTED_OPS} ${second}`,
      FAKE_CODE: 'P3018',
    });

    expect(r.status).toBe(0);
    expect(r.resolveApplied).toEqual(expect.arrayContaining([ENCRYPTED_OPS, second]));
  });
});
