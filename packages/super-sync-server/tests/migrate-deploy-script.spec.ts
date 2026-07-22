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

// Drives scripts/migrate-deploy.sh end-to-end with a fake `npx prisma` so its
// guarded recovery paths are exercised without a real database.

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(currentDir, '../scripts/migrate-deploy.sh');

const ENCRYPTED_OPS = '20260514000000_add_encrypted_ops_partial_index';
const ENCRYPTED_OPS_SQL = `DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx";
CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx"
  ON "operations"("user_id", "server_seq")
  WHERE "is_payload_encrypted" = true;`;

const PLAIN_MIGRATION = '20260601000000_add_plain_column';
const PLAIN_SQL = `ALTER TABLE "operations" ADD COLUMN "foo" TEXT;`;

const FASTUPDATE_MIGRATION = '20260720000000_disable_operation_entity_ids_gin_fastupdate';
const FASTUPDATE_SQL = readFileSync(
  join(currentDir, '../prisma/migrations', FASTUPDATE_MIGRATION, 'migration.sql'),
  'utf8',
);

interface RunResult {
  status: number;
  stdout: string;
  executedSql: string;
  resolveApplied: string[];
  resolveRolledBack: string[];
  databaseUrls: string[];
  prismaCommands: string[];
  timeoutCommands: string[];
  deployAttempts: number;
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
printf '%s\\n' "$*" >> "$FAKE_STATE/prisma_commands"
shift # drop "prisma"
sub="$1"; shift
state="$FAKE_STATE"
# Record the URL every prisma invocation actually receives, so the migrator's
# statement_timeout guardrail can be asserted on the recovery paths too.
printf '%s\\n' "\${DATABASE_URL:-<unset>}" >> "$state/database_urls"
case "$sub" in
  migrate)
    action="$1"; shift
    case "$action" in
      deploy)
        echo deploy >> "$state/deploy_attempts"
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
              LOCK_TIMEOUT)
                # Fails FAKE_LOCK_TIMEOUT_TIMES times (default 1), then applies,
                # so a test can pin how many native retries actually happen.
                times="\${FAKE_LOCK_TIMEOUT_TIMES:-1}"
                seen=0
                [ -f "$state/lock_timeout_count_$m" ] && seen=$(cat "$state/lock_timeout_count_$m")
                if [ "\${FAKE_LOCK_TIMEOUT_ALWAYS:-0}" != "1" ] && [ "$seen" -ge "$times" ]; then
                  : > "$state/applied_$m"
                  continue
                fi
                echo $((seen + 1)) > "$state/lock_timeout_count_$m"
                echo "Applying migration \\\`$m\\\`"
                if [ "\${FAKE_COLOR:-0}" = "1" ]; then
                  # Prisma wraps the code in ANSI under FORCE_COLOR; the gates
                  # must still fire, so the log is stripped at capture.
                  printf '\\033[1m\\033[31mError: \\033[39m\\033[22m\\033[31mP3018\\033[39m\\n'
                else
                  echo "Error: P3018"
                fi
                echo "A migration failed to apply. New migrations cannot be applied before the error is recovered from."
                echo "Migration name: $m"
                echo "Database error code: 55P03"
                echo "Database error:"
                echo "ERROR: canceling statement due to lock timeout"
                ;;
              P3009)
                if [ -f "$state/rolledback_$m" ]; then
                  : > "$state/applied_$m"
                  continue
                fi
                echo "Error: P3009"
                echo "migrate found failed migrations in the target database, new migrations will not be applied."
                echo "The \\\`$m\\\` migration started at 2026-05-15 failed"
                [ -n "\${FAKE_DECOY:-}" ] && echo "Applying migration \\\`\$FAKE_DECOY\\\`"
                ;;
              INTERRUPT)
                # A CONCURRENTLY build killed mid-apply (external SIGTERM/OOM):
                # the migration name is visible in the "Applying" line, but no
                # P3018/P3009 gate marker is emitted and the process exits with
                # a non-gate code (137 stands in for any external kill; a raw
                # 143 would be normalized to the timeout branch instead).
                echo "Applying migration \\\`$m\\\`"
                echo "Terminated"
                exit 137
                ;;
              P1002)
                # Another session holds Prisma's migration advisory lock, so
                # deploy times out before applying anything. No migration name
                # or gate marker is emitted — the script must recognize this
                # from the P1002 + advisory-lock text, not a failing migration.
                echo "Error: P1002"
                echo "The database server was reached but timed out."
                echo "Context: Timed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369)). Elapsed: 10000ms."
                ;;
              DECOY_CODES)
                echo "Applying migration \\\`$m\\\`"
                echo "Error: P1001"
                echo "Diagnostic context only: P3018 P3009 25001 55P03"
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
          rolledback_exit="\${FAKE_ROLLEDBACK_EXIT:-0}"
          if [ "$rolledback_exit" -ne 0 ]; then
            exit "$rolledback_exit"
          fi
          : > "$state/rolledback_$name"
          exit 0
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

const run = (env: Record<string, string>, args: string[] = []): RunResult => {
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync('sh', [SCRIPT, ...args], {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 60_000,
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
    databaseUrls: read('database_urls').split('\n').filter(Boolean),
    prismaCommands: read('prisma_commands').split('\n').filter(Boolean),
    timeoutCommands: read('timeout_commands').split('\n').filter(Boolean),
    deployAttempts: read('deploy_attempts').split('\n').filter(Boolean).length,
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

describe('migrate-deploy.sh recovery', () => {
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

  it('rolls back and retries a lock-bounded migration natively after a lock timeout', () => {
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({
      FAKE_FAIL: FASTUPDATE_MIGRATION,
      FAKE_CODE: 'LOCK_TIMEOUT',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL:
        'postgresql://u:p@postgres:5432/supersync?options=-c%20statement_timeout%3D60000',
    });

    expect(r.status).toBe(0);
    expect(r.deployAttempts).toBe(2);
    expect(r.resolveRolledBack).toEqual([FASTUPDATE_MIGRATION]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
    expect(r.databaseUrls).toHaveLength(3);
    expect(r.databaseUrls.every((url) => url.includes('statement_timeout%3D2000'))).toBe(
      true,
    );
    const applicationNames = r.databaseUrls.map((url) =>
      new URL(url).searchParams.get('application_name'),
    );
    expect(applicationNames[0]).toMatch(/^supersync-migrator-[0-9a-f-]{36}$/);
    expect(new Set(applicationNames).size).toBe(1);
  });

  it('clears the failed row and exits cleanly retryable after a repeated lock timeout', () => {
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({
      FAKE_FAIL: FASTUPDATE_MIGRATION,
      FAKE_CODE: 'LOCK_TIMEOUT',
      FAKE_LOCK_TIMEOUT_ALWAYS: '1',
    });

    expect(r.status).not.toBe(0);
    // The retry budget is bounded and exhausted; the record is left rolled back
    // after every attempt, so re-running the deploy is always safe.
    expect(r.deployAttempts).toBe(10);
    expect(r.resolveRolledBack).toHaveLength(10);
    expect(new Set(r.resolveRolledBack)).toEqual(new Set([FASTUPDATE_MIGRATION]));
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
    expect(r.stdout).toContain(
      'could not take its lock in 10 attempts and was left rolled back',
    );
  });

  it('accepts a millisecond bound at the cap', () => {
    // The reject cases below pin the ceiling, but nothing else accepts a `ms`
    // value at all — deleting the whole millisecond alternation used to leave
    // the suite green while silently refusing every documented ms migration.
    const msMigration = '20260902000000_bound_in_ms';
    writeMigration(
      msMigration,
      `SET LOCAL lock_timeout = '5000ms';\nALTER INDEX "users_email_key" SET (fillfactor = 90);`,
    );

    const r = run({ FAKE_FAIL: msMigration, FAKE_CODE: 'LOCK_TIMEOUT' });

    expect(r.status).toBe(0);
    expect(r.deployAttempts).toBe(2);
    expect(r.resolveRolledBack).toEqual([msMigration]);
  });

  it('gives each lock-bounded migration its own retry budget in one deploy', () => {
    // Nothing else uses two lock-bounded migrations, so the counter reset was
    // dead code. This also pins the run-level cost: the budget is PER MIGRATION.
    const second = '20260903000000_bound_users_fillfactor';
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);
    writeMigration(
      second,
      `SET LOCAL lock_timeout = '1s';\nALTER INDEX "users_email_key" SET (fillfactor = 90);`,
    );

    const r = run({
      FAKE_FAIL: `${FASTUPDATE_MIGRATION} ${second}`,
      FAKE_CODE: 'LOCK_TIMEOUT',
      FAKE_LOCK_TIMEOUT_TIMES: '6',
    });

    // 6 failures each, then a win each: neither migration inherits the other's
    // spent budget (which would exhaust at 10 and fail).
    expect(r.status).toBe(0);
    expect(r.resolveRolledBack).toHaveLength(12);
    expect(r.deployAttempts).toBe(13);
  });

  it('recovers when Prisma colorizes its error output', () => {
    // `^Error: P3018$` is the first conjunct of all three failure detectors, so
    // an ANSI-wrapped code would disable every recovery path at once.
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({
      FAKE_FAIL: FASTUPDATE_MIGRATION,
      FAKE_CODE: 'LOCK_TIMEOUT',
      FAKE_COLOR: '1',
    });

    expect(r.status).toBe(0);
    expect(r.deployAttempts).toBe(2);
    expect(r.resolveRolledBack).toEqual([FASTUPDATE_MIGRATION]);
  });

  it('retries a lock-bounded migration more than once (a single retry is a coin flip)', () => {
    // Production 2026-07-21: one deploy lost both of its two allowed attempts,
    // the next won on its second. A budget of one retry cannot survive that.
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({
      FAKE_FAIL: FASTUPDATE_MIGRATION,
      FAKE_CODE: 'LOCK_TIMEOUT',
      FAKE_LOCK_TIMEOUT_TIMES: '4',
    });

    expect(r.status).toBe(0);
    expect(r.deployAttempts).toBe(5);
    expect(r.resolveRolledBack).toHaveLength(4);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('retries a lock-bounded migration under any migration and index name', () => {
    // The gate is on SHAPE, not on a name. Lowercase keywords and irregular
    // spacing are deliberately tolerated too (grep -Ei + [[:space:]]), so a
    // future author does not lose the retry path to formatting; at the upper
    // bound of the allowed lock_timeout, which pins the accept side of the cap.
    const other = '20260901000000_bound_users_fillfactor';
    writeMigration(
      other,
      `set local  lock_timeout='5s';\nalter  index "users_email_key"  set ( fillfactor = 90 );`,
    );

    const r = run({
      FAKE_FAIL: other,
      FAKE_CODE: 'LOCK_TIMEOUT',
    });

    expect(r.status).toBe(0);
    expect(r.deployAttempts).toBe(2);
    expect(r.resolveRolledBack).toEqual([other]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('recovers a pre-existing failed fastupdate migration and retries it natively', () => {
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({
      FAKE_FAIL: FASTUPDATE_MIGRATION,
      FAKE_CODE: 'P3009',
    });

    expect(r.status).toBe(0);
    expect(r.deployAttempts).toBe(2);
    expect(r.resolveRolledBack).toEqual([FASTUPDATE_MIGRATION]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('stops without retrying when rollback resolution fails for fastupdate', () => {
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({
      FAKE_FAIL: FASTUPDATE_MIGRATION,
      FAKE_CODE: 'LOCK_TIMEOUT',
      FAKE_ROLLEDBACK_EXIT: '1',
    });

    expect(r.status).not.toBe(0);
    expect(r.deployAttempts).toBe(1);
    expect(r.resolveRolledBack).toEqual([FASTUPDATE_MIGRATION]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it.each([
    {
      // A third statement means the migration is no longer the atomic
      // two-statement shape whose re-run is provably free.
      label: 'an extra statement',
      sql: `${FASTUPDATE_SQL}\nSELECT 1;`,
    },
    {
      // Bounds the wrong GUC. Without a lock_timeout the ALTER queues every new
      // query on the table behind its waiting ACCESS EXCLUSIVE request instead
      // of failing fast, so retrying it is not the safe move.
      label: 'a bound on the wrong setting',
      sql: `SET LOCAL statement_timeout = '1s';\nALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);`,
    },
    {
      // No bound at all.
      label: 'no lock_timeout bound',
      sql: `ALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);`,
    },
    {
      // A CONCURRENTLY migration must never take this path: Postgres gives a
      // single-statement migration no implicit transaction, so a lock timeout
      // mid-build leaves an INVALID index a retry cannot clear.
      label: 'a CONCURRENTLY index build',
      sql: `SET LOCAL lock_timeout = '1s';\nDROP INDEX CONCURRENTLY IF EXISTS "operations_entity_ids_gin";`,
    },
    {
      // split_statements breaks on `;` at END OF LINE, so a second statement
      // sharing the ALTER's line arrives as one chunk that still ends in `);`.
      // What rejects it is the ALTER pattern's anchored, PAREN-FREE option list:
      // the ALTER's own `)` lands inside the span, so nothing can follow it.
      label: 'a CONCURRENTLY build smuggled onto the ALTER line',
      sql: `SET LOCAL lock_timeout = '1s';\nALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off); CREATE INDEX CONCURRENTLY "x" ON "operations"("user_id");`,
    },
    {
      // '0' DISABLES lock_timeout in PostgreSQL — i.e. wait forever. Retrying
      // that is the outage shape the bound exists to prevent, 10x over.
      label: 'a disabled lock_timeout',
      sql: `SET LOCAL lock_timeout = '0';\nALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);`,
    },
    {
      // Likewise any long bound: the ALTER would queue every new query on the
      // table behind its waiting ACCESS EXCLUSIVE request for 30 minutes.
      label: 'an oversized lock_timeout',
      sql: `SET LOCAL lock_timeout = '30min';\nALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);`,
    },
    {
      // Just over the cap, in each unit — pins the boundary itself, so the two
      // branches of the bound cannot drift apart (9999ms once meant ~10s while
      // 6s was refused).
      label: 'a bound just over the cap in seconds',
      sql: `SET LOCAL lock_timeout = '6s';\nALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);`,
    },
    {
      label: 'a bound just over the cap in milliseconds',
      sql: `SET LOCAL lock_timeout = '5001ms';\nALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);`,
    },
  ])('refuses lock-timeout recovery for $label', ({ sql }) => {
    writeMigration(FASTUPDATE_MIGRATION, sql);

    const r = run({ FAKE_FAIL: FASTUPDATE_MIGRATION, FAKE_CODE: 'LOCK_TIMEOUT' });

    expect(r.status).not.toBe(0);
    // Assert the REASON, not just that it stopped — every other fail_loudly
    // also yields a non-zero status with nothing resolved, so without this the
    // block cannot tell "refused the lock timeout" from "refused the shape".
    expect(r.stdout).toContain('refusing to auto-resolve its lock timeout');
    expect(r.deployAttempts).toBe(1);
    expect(r.resolveRolledBack).toEqual([]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('never auto-recovers a CONCURRENTLY migration that lock-timed-out', () => {
    // The guard this pins is the only thing stopping a 55P03 on a CONCURRENTLY
    // migration from falling through to out-of-band execution + `resolve
    // --applied` — the shape of the 2026-05-18 missing-index outage (#7654).
    // Reachable whenever DATABASE_URL carries an operator lock_timeout, which
    // applies to migrations that set none themselves.
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);

    const r = run({ FAKE_FAIL: ENCRYPTED_OPS, FAKE_CODE: 'LOCK_TIMEOUT' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('refusing to auto-resolve its lock timeout');
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('does not recover the fastupdate shape for a non-lock P3018 failure', () => {
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({ FAKE_FAIL: FASTUPDATE_MIGRATION, FAKE_CODE: 'P3018' });

    expect(r.status).not.toBe(0);
    expect(r.deployAttempts).toBe(1);
    expect(r.resolveRolledBack).toEqual([]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
  });

  it('does not treat diagnostic code substrings as a recoverable error', () => {
    writeMigration(FASTUPDATE_MIGRATION, FASTUPDATE_SQL);

    const r = run({ FAKE_FAIL: FASTUPDATE_MIGRATION, FAKE_CODE: 'DECOY_CODES' });

    expect(r.status).not.toBe(0);
    expect(r.deployAttempts).toBe(1);
    expect(r.resolveRolledBack).toEqual([]);
    expect(r.resolveApplied).toEqual([]);
    expect(r.executedSql).toBe('');
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

  it('prints copy-paste recovery for a stuck bare CREATE INDEX CONCURRENTLY', () => {
    // An interrupted bare CREATE (e.g. a step timeout) leaves the migration
    // failed (P3009) and an INVALID index of the same name; the loud failure
    // must tell the operator to drop it and roll the record back — never
    // auto-resolve it.
    const bare = '20260701000000_add_bare_concurrent_index';
    const bareSql = `CREATE INDEX CONCURRENTLY "operations_bare_idx"
  ON "operations"("user_id", "server_seq");`;
    writeMigration(bare, bareSql);
    const r = run({
      FAKE_FAIL: bare,
      FAKE_CODE: 'P3009',
      MIGRATE_RECOVERY_RUNTIME: 'compose',
    });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('not a recoverable drop-then-create');
    expect(r.stdout).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_bare_idx";',
    );
    expect(r.stdout).toContain(`migrate resolve --rolled-back '${bare}'`);
    expect(r.stdout).toContain(
      'docker compose run --rm --no-deps -T -e "MIGRATE_STEP_TIMEOUT=1800" supersync sh scripts/migrate-deploy.sh --prisma',
    );
    expect(r.resolveApplied).toEqual([]);
    expect(r.resolveRolledBack).toEqual([]);
  });

  it('reports a BusyBox timeout (exit 143) as a timeout, not a generic failure', () => {
    // node:*-alpine ships BusyBox `timeout`, which returns 128+SIGTERM=143 on
    // expiry (GNU coreutils returns 124). A fake `timeout` on PATH reproduces
    // that: run the wrapped command, then exit 143 as if the step was TERMed.
    // migrate-deploy.sh must normalize this to its timeout branch.
    const fakeTimeout = join(binDir, 'timeout');
    writeFileSync(fakeTimeout, '#!/bin/sh\nshift 3\n"$@"\nexit 143\n');
    chmodSync(fakeTimeout, 0o755);

    const r = run({ FAKE_FAIL: '', FAKE_CODE: 'P3018' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('timed out after');
    expect(r.resolveApplied).toEqual([]);
  });

  it('prints bare-create recovery when a normalized-143 timeout aborts a bare CONCURRENTLY build (the incident)', () => {
    // The reported incident: a bare CREATE INDEX CONCURRENTLY killed by the
    // in-image step timeout (BusyBox SIGTERM -> 143 -> normalized to the 124
    // timeout branch). That branch must ALSO print the drop-INVALID-index
    // recovery, because raising the timeout alone cannot rebuild an INVALID
    // index left by the aborted build.
    const fakeTimeout = join(binDir, 'timeout');
    writeFileSync(fakeTimeout, '#!/bin/sh\nshift 3\n"$@"\nexit 143\n');
    chmodSync(fakeTimeout, 0o755);
    const bare = '20260701000000_add_bare_concurrent_index';
    const bareSql = `CREATE INDEX CONCURRENTLY "operations_bare_idx"
  ON "operations"("user_id", "server_seq");`;
    writeMigration(bare, bareSql);
    const r = run({ FAKE_FAIL: bare, FAKE_CODE: 'INTERRUPT' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('timed out after');
    expect(r.stdout).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_bare_idx";',
    );
    expect(r.stdout).toContain(`migrate resolve --rolled-back '${bare}'`);
    expect(r.resolveApplied).toEqual([]);
    expect(r.resolveRolledBack).toEqual([]);
  });

  it('surfaces bare-create recovery when a CONCURRENTLY build is interrupted (non-gate exit)', () => {
    // The user's incident: a bare CREATE INDEX CONCURRENTLY killed mid-build
    // exits with a non-P3018/P3009 code before Prisma records the failure. The
    // first failure must still print copy-paste recovery for the INVALID index
    // (drop it, roll the record back), never a bare exit code.
    const bare = '20260701000000_add_bare_concurrent_index';
    const bareSql = `CREATE INDEX CONCURRENTLY "operations_bare_idx"
  ON "operations"("user_id", "server_seq");`;
    writeMigration(bare, bareSql);
    const r = run({ FAKE_FAIL: bare, FAKE_CODE: 'INTERRUPT' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_bare_idx";',
    );
    expect(r.stdout).toContain(`migrate resolve --rolled-back '${bare}'`);
    // Guidance only — the interrupted migration must never be auto-resolved.
    expect(r.resolveApplied).toEqual([]);
    expect(r.resolveRolledBack).toEqual([]);
  });

  it('hints a re-run when an auto-recoverable CONCURRENTLY migration is interrupted', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({ FAKE_FAIL: ENCRYPTED_OPS, FAKE_CODE: 'INTERRUPT' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('re-run the deploy to finish it');
    expect(r.resolveApplied).toEqual([]);
    expect(r.resolveRolledBack).toEqual([]);
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

  it('prints advisory-lock recovery on a P1002 lock timeout, without resolving anything', () => {
    // Another session holds Prisma's migration advisory lock (e.g. a migrator
    // container orphaned by a prior interrupted deploy), so migrate deploy
    // times out before applying anything. This is NOT a migration failure:
    // print cleanup guidance, never mark a migration applied or rolled-back.
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({ FAKE_FAIL: ENCRYPTED_OPS, FAKE_CODE: 'P1002' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('advisory lock');
    expect(r.stdout).toContain('supersync-migrator');
    expect(r.stdout).toContain('pg_terminate_backend');
    // The lock timeout is not a failing migration — nothing gets resolved.
    expect(r.resolveApplied).toEqual([]);
    expect(r.resolveRolledBack).toEqual([]);
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

// #9191: operators may cap application statements through DATABASE_URL. Migrations
// use the larger, finite MIGRATE_STEP_TIMEOUT budget instead so PostgreSQL cannot
// keep running a query after its Prisma client has been terminated.
describe('migrate-deploy.sh statement_timeout guardrail', () => {
  const BASE = 'postgresql://u:p@postgres:5432/supersync';

  it('overrides an existing statement_timeout with the finite migration budget', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: `${BASE}?connection_limit=60&pool_timeout=20&options=-c%20statement_timeout%3D60000`,
    });

    expect(r.status).toBe(0);
    expect(r.databaseUrls).not.toHaveLength(0);
    for (const url of r.databaseUrls) {
      expect(url).toContain('statement_timeout%3D2000');
      expect(url).toMatch(/statement_timeout%3D60000.*statement_timeout%3D2000/);
      // The pool settings are not ours to touch.
      expect(url).toContain('connection_limit=60');
      expect(url).toContain('pool_timeout=20');
    }
  });

  it('rejects a secret-backed URL without explicit pool guardrails', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      DATABASE_URL: `${BASE}?connection_limit=60`,
      REQUIRE_DATABASE_POOL_LIMITS: 'true',
    });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain(
      'DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each',
    );
    expect(r.prismaCommands).toEqual([]);
  });

  it.each([
    'connection_limit=60&connection_limit=0&pool_timeout=10',
    'connection_limit=60&pool_timeout=10&pool_timeout=0',
    'connection_limit=9007199254740992&pool_timeout=10',
    'connection_limit=60&pool_timeout=9007199254740992',
  ])('rejects invalid pool guardrails in %s', (query) => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      DATABASE_URL: `${BASE}?${query}`,
      REQUIRE_DATABASE_POOL_LIMITS: 'true',
    });

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain(
      'DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each',
    );
    expect(r.prismaCommands).toEqual([]);
  });

  it('runs manual recovery commands through the protected Prisma wrapper', () => {
    const r = run(
      {
        FAKE_FAIL: '',
        FAKE_CODE: 'P3018',
        MIGRATE_STEP_TIMEOUT: '7',
        DATABASE_URL: `${BASE}?connection_limit=60&pool_timeout=10&options=-c%20statement_timeout%3D60000`,
        REQUIRE_DATABASE_POOL_LIMITS: 'true',
      },
      ['--prisma', 'migrate', 'resolve', '--rolled-back', ENCRYPTED_OPS],
    );

    expect(r.status).toBe(0);
    expect(r.prismaCommands).toEqual([
      `prisma migrate resolve --rolled-back ${ENCRYPTED_OPS}`,
    ]);
    expect(r.databaseUrls[0]).toMatch(
      /statement_timeout%3D60000.*statement_timeout%3D2000/,
    );
    expect(new URL(r.databaseUrls[0]).searchParams.get('application_name')).toMatch(
      /^supersync-migrator-[0-9a-f-]{36}$/,
    );
  });

  it('bounds manual recovery commands with the same client timeout wrapper', () => {
    const timeoutPath = join(binDir, 'timeout');
    writeFileSync(
      timeoutPath,
      '#!/bin/sh\ncase "$*" in *"npx prisma"*) printf \'%s\\n\' "$*" >> "$FAKE_STATE/timeout_commands" ;; esac\nexit 124\n',
    );
    chmodSync(timeoutPath, 0o755);

    const r = run(
      {
        FAKE_FAIL: '',
        FAKE_CODE: 'P3018',
        MIGRATE_STEP_TIMEOUT: '7',
      },
      ['--prisma', 'migrate', 'resolve', '--rolled-back', ENCRYPTED_OPS],
    );

    expect(r.status).toBe(124);
    expect(r.timeoutCommands).toEqual([
      `-k 5 7 npx prisma migrate resolve --rolled-back ${ENCRYPTED_OPS}`,
    ]);
    expect(r.prismaCommands).toEqual([]);
  });

  it('keeps the guardrail on the recovery paths, not just the first deploy', () => {
    writeMigration(ENCRYPTED_OPS, ENCRYPTED_OPS_SQL);
    const r = run({
      FAKE_FAIL: ENCRYPTED_OPS,
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: `${BASE}?options=-c%20statement_timeout%3D60000`,
    });

    expect(r.status).toBe(0);
    // deploy → resolve → db execute → resolve → deploy: several invocations, and
    // the out-of-band `db execute` is the one that actually builds the index.
    expect(r.databaseUrls.length).toBeGreaterThan(1);
    expect(r.databaseUrls.every((u) => u.includes('statement_timeout%3D2000'))).toBe(
      true,
    );
  });

  it('extends an existing options value instead of adding a second options param', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: `${BASE}?options=-c%20lock_timeout%3D5000&connection_limit=60`,
    });

    const url = r.databaseUrls[0];
    expect(url).toContain('statement_timeout%3D2000');
    // Prisma resolves a duplicated param to one of the two — silently dropping
    // either the pre-existing setting or our guardrail.
    expect(url.match(/options=/g)).toHaveLength(1);
    expect(url).toContain('lock_timeout%3D5000');
    expect(url).toContain('connection_limit=60');
  });

  it('does not mistake a URL component for the statement_timeout option', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: `postgresql://statement_timeout:p@postgres:5432/supersync?connection_limit=60`,
    });

    expect(r.databaseUrls[0]).toContain('options=-c%20statement_timeout%3D2000');
  });

  it('identifies every Prisma migration connection to monitoring', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      DATABASE_URL: `${BASE}?options=-c%20lock_timeout%3D5000`,
    });

    expect(r.databaseUrls).not.toHaveLength(0);
    expect(
      r.databaseUrls.every((url) =>
        /^supersync-migrator-[0-9a-f-]{36}$/.test(
          new URL(url).searchParams.get('application_name') ?? '',
        ),
      ),
    ).toBe(true);
    expect(
      new Set(
        r.databaseUrls.map((url) => new URL(url).searchParams.get('application_name')),
      ).size,
    ).toBe(1);
  });

  it('replaces an existing application_name query parameter', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      DATABASE_URL: `${BASE}?application_name=existing-app`,
    });

    expect(new URL(r.databaseUrls[0]).searchParams.get('application_name')).toMatch(
      /^supersync-migrator-[0-9a-f-]{36}$/,
    );
  });

  it('collapses duplicate protected parameters so later values cannot override them', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: `${BASE}?options=-c%20lock_timeout%3D5000&options=-c%20statement_timeout%3D60000&application_name=first&application_name=last`,
    });

    const url = new URL(r.databaseUrls[0]);
    const options = url.searchParams.getAll('options');
    expect(options).toHaveLength(1);
    expect(options[0]).toBe(
      '-c lock_timeout=5000 -c statement_timeout=60000 -c statement_timeout=2000',
    );
    expect(url.searchParams.getAll('application_name')).toEqual([
      expect.stringMatching(/^supersync-migrator-[0-9a-f-]{36}$/),
    ]);
  });

  it('appends with & when the URL already has a query string', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: `${BASE}?connection_limit=60`,
    });

    expect(r.databaseUrls[0]).toContain(
      `${BASE}?connection_limit=60&options=-c%20statement_timeout%3D2000&application_name=supersync-migrator-`,
    );
  });

  it('appends with ? when the URL has no query string', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '7',
      DATABASE_URL: BASE,
    });

    expect(r.databaseUrls[0]).toContain(
      `${BASE}?options=-c%20statement_timeout%3D2000&application_name=supersync-migrator-`,
    );
  });

  it.each(['0', '01', '-1', '1.5', 'abc', '2147484', '99999999999999999999'])(
    'rejects invalid MIGRATE_STEP_TIMEOUT=%s before invoking Prisma',
    (timeout) => {
      const r = run({
        FAKE_FAIL: '',
        FAKE_CODE: 'P3018',
        MIGRATE_STEP_TIMEOUT: timeout,
        DATABASE_URL: BASE,
      });

      expect(r.status).not.toBe(0);
      expect(r.stdout).toContain(
        'MIGRATE_STEP_TIMEOUT must be an integer from 1 to 2147483 seconds',
      );
      expect(r.prismaCommands).toEqual([]);
    },
  );

  it('clamps the database timeout to one second for a short client budget', () => {
    const r = run({
      FAKE_FAIL: '',
      FAKE_CODE: 'P3018',
      MIGRATE_STEP_TIMEOUT: '3',
      DATABASE_URL: BASE,
    });

    expect(r.status).toBe(0);
    expect(r.databaseUrls[0]).toContain('statement_timeout%3D1000');
  });

  it('does nothing when DATABASE_URL is unset', () => {
    const r = run({ FAKE_FAIL: '', FAKE_CODE: 'P3018' });

    expect(r.status).toBe(0);
    expect(r.databaseUrls).toEqual(['<unset>']);
  });
});
