import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('performance migrations', () => {
  it('adds the entity sequence index without a blocking or destructive migration', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260511000000_add_entity_sequence_index/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(migrationSql).toContain(
      '"operations_user_id_entity_type_entity_id_server_seq_idx"',
    );
    expect(migrationSql).toContain(
      'ON "operations"("user_id", "entity_type", "entity_id", "server_seq")',
    );
    expect(migrationSql).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds partial full-state sequence index and drops redundant indexes', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260512000000_add_full_state_sequence_index_drop_redundant_indexes/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain('"operations_user_id_full_state_server_seq_idx"');
    expect(migrationSql).toContain('ON "operations"("user_id", "server_seq")');
    expect(migrationSql).toContain(
      `WHERE "op_type" IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')`,
    );
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_op_type_idx"',
    );
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_entity_type_entity_id_idx"',
    );
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_idx"',
    );
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds partial encrypted-op sequence index concurrently', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260514000000_add_encrypted_ops_partial_index/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx"',
    );
    expect(migrationSql).toContain('"operations_user_id_server_seq_encrypted_idx"');
    expect(migrationSql).toContain('ON "operations"("user_id", "server_seq")');
    expect(migrationSql).toContain('WHERE "is_payload_encrypted" = true');
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds operation payload_bytes as a metadata-only column (no table rewrite)', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260514000001_add_operation_payload_bytes/migration.sql',
      ),
      'utf8',
    );

    // ADD COLUMN ... NOT NULL DEFAULT <constant> is a metadata-only operation on
    // PostgreSQL 11+ (the default is stored in pg_attribute, no table rewrite).
    // These guards lock in the fast path: a future edit to a volatile/expression
    // default or a separate UPDATE backfill would rewrite/lock a 100M-row table.
    expect(migrationSql).toMatch(
      /ALTER TABLE "operations"\s+ADD COLUMN "payload_bytes" BIGINT NOT NULL DEFAULT 0/i,
    );
    expect(migrationSql).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSql).not.toMatch(/\bUSING\b/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+(?!0\b)/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds the payload_bytes unbackfilled partial index concurrently', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260514000002_add_payload_bytes_unbackfilled_index/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_payload_bytes_unbackfilled_idx"',
    );
    expect(migrationSql).toContain('"operations_payload_bytes_unbackfilled_idx"');
    expect(migrationSql).toContain('ON "operations"("user_id", "id")');
    // Partial predicate must match the boot self-check / quota probe
    // (payload_bytes = 0) so the index drains to empty post-backfill.
    expect(migrationSql).toContain('WHERE "payload_bytes" = 0');
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('runs migrations before replacing the app during compose deploys', () => {
    const deployScript = readFileSync(join(currentDir, '../scripts/deploy.sh'), 'utf8');
    const runtimeMigrateScript = readFileSync(
      join(currentDir, '../scripts/migrate-deploy.sh'),
      'utf8',
    );
    const buildAndPushScript = readFileSync(
      join(currentDir, '../scripts/build-and-push.sh'),
      'utf8',
    );
    const dockerfile = readFileSync(join(currentDir, '../Dockerfile'), 'utf8');
    const composeFile = readFileSync(join(currentDir, '../docker-compose.yml'), 'utf8');
    const composeBuildFile = readFileSync(
      join(currentDir, '../docker-compose.build.yml'),
      'utf8',
    );
    const helmDeployment = readFileSync(
      join(currentDir, '../helm/supersync/templates/deployment.yaml'),
      'utf8',
    );
    const dockerWorkflow = readFileSync(
      join(currentDir, '../../../.github/workflows/supersync-docker.yml'),
      'utf8',
    );
    const migrationCommand = 'sh scripts/migrate-deploy.sh';
    const startCommand = 'up -d --wait --wait-timeout "$WAIT_TIMEOUT"';
    const externalDbStartCommand =
      'up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps supersync caddy';

    expect(deployScript).toContain('POSTGRES_WAIT_TIMEOUT');
    expect(deployScript).toContain('load_env_value()');
    expect(deployScript).toContain('POSTGRES_SERVICE="${POSTGRES_SERVICE-postgres}"');
    expect(deployScript).toContain('@db:5432');
    expect(deployScript).toContain('@postgres:5432');
    expect(deployScript).toContain('SUPER_SYNC_DEPLOY_REEXECED');
    expect(deployScript).toMatch(/git hash-object/);
    expect(deployScript).toMatch(/exec\s+"\$DEPLOY_SCRIPT_FILE"/);
    expect(deployScript).toContain('verify_supersync_image_revision()');
    expect(deployScript).toContain('supersync_image_source_revision()');
    expect(deployScript).toContain('assert_clean_supersync_image_inputs()');
    expect(deployScript).toContain('git log -1 --format=%H');
    expect(deployScript).toContain('../../.dockerignore');
    expect(deployScript).toContain('git ls-files --others --exclude-standard');
    expect(deployScript).toContain('packages/shared-schema');
    expect(deployScript).toContain('Refusing to build a labeled supersync image');
    expect(deployScript).toContain('SUPERSYNC_SKIP_IMAGE_REVISION_CHECK');
    expect(deployScript).toContain('org.opencontainers.image.revision');
    expect(deployScript).toContain('config --format json');
    expect(deployScript).toContain('.services.supersync.image // empty');
    expect(deployScript).toContain('jq is required');
    expect(deployScript).toContain('docker compose config --format json failed');
    expect(deployScript).toContain('docker image inspect');
    expect(deployScript).toContain('run --rm --no-deps --interactive=false -T supersync');
    expect(deployScript).toContain('prisma db execute');
    expect(deployScript).toContain(migrationCommand);
    expect(deployScript).toContain('Migrator container started');
    expect(deployScript).toContain('prisma db execute --schema prisma/schema.prisma');
    // Recovery now lives in the in-image scripts/migrate-deploy.sh. The host
    // must NOT re-hardcode migration names or index DDL: that lockstep
    // host/image coupling is exactly what caused the production skew bug.
    expect(deployScript).not.toMatch(/_INDEX_MIGRATION=/);
    expect(deployScript).not.toContain('run_concurrent_index_sql');
    expect(deployScript).not.toContain('CREATE INDEX CONCURRENTLY "operations');
    // Host still owns the timeout + exit-code policy around the migrator.
    expect(deployScript).toContain('timeout "$MIGRATION_TIMEOUT"');
    expect(deployScript).toContain('prisma migrate deploy timed out');
    expect(deployScript).toContain('database migrations failed (exit $MIGRATE_STATUS)');
    expect(deployScript).toContain(externalDbStartCommand);
    expect(deployScript).toContain('RUN_MIGRATIONS_ON_STARTUP');
    expect(deployScript.indexOf(migrationCommand)).toBeLessThan(
      deployScript.indexOf(startCommand),
    );
    expect(dockerfile).toContain('ARG VCS_REF=unknown');
    expect(dockerfile).toContain('LABEL org.opencontainers.image.revision=$VCS_REF');
    expect(dockerfile).toContain('RUN_MIGRATIONS_ON_STARTUP');
    expect(dockerfile).toContain('sh scripts/migrate-deploy.sh');
    expect(dockerfile).toContain('NODE_OPTIONS=--max-old-space-size=576');
    expect(composeBuildFile).toContain('VCS_REF: ${SUPERSYNC_BUILD_SHA:-local}');
    expect(buildAndPushScript).toContain('supersync_image_source_revision()');
    expect(buildAndPushScript).toContain('assert_clean_supersync_image_inputs');
    expect(buildAndPushScript).toContain('git -C "$REPO_ROOT" log -1 --format=%H');
    expect(buildAndPushScript).toContain('.dockerignore');
    expect(buildAndPushScript).toContain('git -C "$REPO_ROOT" ls-files --others');
    expect(buildAndPushScript).toContain('--build-arg "VCS_REF=$VCS_REF"');
    expect(dockerWorkflow).toContain('push:');
    expect(dockerWorkflow).toContain('branches:');
    expect(dockerWorkflow).toContain('- master');
    expect(dockerWorkflow).toContain('fetch-depth: 0');
    expect(dockerWorkflow).toContain('.dockerignore');
    expect(dockerWorkflow).toContain('packages/super-sync-server/**');
    expect(dockerWorkflow).toContain('Resolve image source revision');
    expect(dockerWorkflow).toContain('Could not resolve SuperSync image source revision');
    expect(dockerWorkflow).toContain('revision=$revision');
    expect(dockerWorkflow).toContain('VCS_REF=${{ steps.source-ref.outputs.revision }}');
    expect(dockerWorkflow).not.toContain('labels: ${{ steps.meta.outputs.labels }}');
    expect(helmDeployment).toContain('sh scripts/migrate-deploy.sh');
    // Architectural invariant (the actual bug class): the generic runtime
    // script must NOT hardcode any migration name or index DDL — that lockstep
    // coupling is what went stale and broke the production deploy. Behavioral
    // coverage of the recovery logic lives in migrate-deploy-script.spec.ts.
    expect(runtimeMigrateScript).toContain('npx prisma migrate deploy');
    expect(runtimeMigrateScript).not.toMatch(/_INDEX_MIGRATION=/);
    expect(runtimeMigrateScript).not.toContain(
      'operations_user_id_server_seq_encrypted_idx',
    );
    expect(runtimeMigrateScript).not.toContain(
      'operations_payload_bytes_unbackfilled_idx',
    );
    expect(runtimeMigrateScript).not.toContain(
      'operations_user_id_full_state_server_seq_idx',
    );
    expect(composeFile).toContain(
      'RUN_MIGRATIONS_ON_STARTUP=${RUN_MIGRATIONS_ON_STARTUP:-false}',
    );
    expect(composeFile).toContain(
      'SUPERSYNC_PAYLOAD_BYTES_BACKFILL_COMPLETE=${SUPERSYNC_PAYLOAD_BYTES_BACKFILL_COMPLETE:-false}',
    );
    expect(composeFile).toContain(
      'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "SELECT 1"',
    );
    expect(composeFile).toContain('aliases:');
    expect(composeFile).toContain('- db');
  });

  it('backfills operation payload bytes with per-user batched updates', () => {
    const script = readFileSync(
      join(currentDir, '../scripts/migrate-payload-bytes.ts'),
      'utf8',
    );
    const packageJson = readFileSync(join(currentDir, '../package.json'), 'utf8');

    expect(script).toContain('SELECT DISTINCT user_id');
    // Batch size sized for throughput: a tiny batch made a 100M-row backfill take
    // tens of hours, prolonging the slow octet_length() quota fallback window.
    expect(script).toContain('const DEFAULT_BATCH_SIZE = 500');
    expect(script).toContain('const MAX_BATCH_SIZE = 1000');
    // The override is still clamped so a fat-fingered value cannot OOM the
    // Node process building the VALUES string.
    expect(script).toContain('Math.min(parsed, MAX_BATCH_SIZE)');
    expect(script).toContain('userId,');
    expect(script).toContain('FROM (VALUES ${values}) AS v(id, bytes)');
    expect(script).toContain('SET payload_bytes = v.bytes');
    expect(script).toContain('storage_used_bytes = usage.total_bytes');
    expect(packageJson).toContain(
      '"migrate-payload-bytes": "node dist/scripts/migrate-payload-bytes.js"',
    );
    expect(packageJson).toContain(
      '"migrate-payload-bytes:dev": "ts-node scripts/migrate-payload-bytes.ts"',
    );
    expect(script).not.toContain('prisma.operation.update({');
  });
});
