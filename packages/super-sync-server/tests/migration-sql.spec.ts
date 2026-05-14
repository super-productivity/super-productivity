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

  it('runs migrations before replacing the app during compose deploys', () => {
    const deployScript = readFileSync(join(currentDir, '../scripts/deploy.sh'), 'utf8');
    const runtimeMigrateScript = readFileSync(
      join(currentDir, '../scripts/migrate-deploy.sh'),
      'utf8',
    );
    const dockerfile = readFileSync(join(currentDir, '../Dockerfile'), 'utf8');
    const composeFile = readFileSync(join(currentDir, '../docker-compose.yml'), 'utf8');
    const helmDeployment = readFileSync(
      join(currentDir, '../helm/supersync/templates/deployment.yaml'),
      'utf8',
    );
    const migrationCommand = 'npx prisma migrate deploy';
    const startCommand = 'up -d --wait --wait-timeout "$WAIT_TIMEOUT"';
    const externalDbStartCommand =
      'up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps supersync caddy';

    expect(deployScript).toContain('POSTGRES_WAIT_TIMEOUT');
    expect(deployScript).toContain('load_env_value()');
    expect(deployScript).toContain('POSTGRES_SERVICE="${POSTGRES_SERVICE-postgres}"');
    expect(deployScript).toContain('@db:5432');
    expect(deployScript).toContain('@postgres:5432');
    expect(deployScript).toContain('run --rm --no-deps --interactive=false -T supersync');
    expect(deployScript).toContain('prisma db execute');
    expect(deployScript).toContain(migrationCommand);
    expect(deployScript).toContain('Migrator container started');
    expect(deployScript).toContain(
      'FULL_STATE_INDEX_MIGRATION="20260512000000_add_full_state_sequence_index_drop_redundant_indexes"',
    );
    expect(deployScript).toContain(
      'ENCRYPTED_OPS_INDEX_MIGRATION="20260514000000_add_encrypted_ops_partial_index"',
    );
    expect(deployScript).toContain('is_recoverable_full_state_index_migration_failure');
    expect(deployScript).toContain(
      'is_recoverable_encrypted_ops_index_migration_failure',
    );
    expect(deployScript).toContain("grep -q 'P3009'");
    expect(deployScript).toContain('is_full_state_index_transaction_block_failure');
    expect(deployScript).toContain("grep -q 'P3018'");
    expect(deployScript).toContain("grep -q 'cannot run inside a transaction block'");
    expect(deployScript).toContain('run_concurrent_index_sql');
    expect(deployScript).toContain(
      'Use the same supersync container and DATABASE_URL as `migrate deploy`',
    );
    expect(deployScript).not.toContain('psql -v ON_ERROR_STOP=1');
    expect(deployScript).toContain('prisma db execute --schema prisma/schema.prisma');
    expect(deployScript).toContain(
      'CREATE INDEX CONCURRENTLY \\"operations_user_id_full_state_server_seq_idx\\"',
    );
    expect(deployScript).toContain(
      'CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx"',
    );
    expect(deployScript).toContain(
      'migrate resolve --rolled-back "$FULL_STATE_INDEX_MIGRATION"',
    );
    expect(deployScript).toContain(
      'migrate resolve --applied "$FULL_STATE_INDEX_MIGRATION"',
    );
    expect(deployScript).toContain(
      'Retrying database migrations after resolving $FULL_STATE_INDEX_MIGRATION',
    );
    expect(deployScript).toContain(
      'Retrying database migrations after applying $FULL_STATE_INDEX_MIGRATION',
    );
    expect(deployScript).toContain(
      'Retrying database migrations after applying $ENCRYPTED_OPS_INDEX_MIGRATION',
    );
    expect(deployScript).toContain(externalDbStartCommand);
    expect(deployScript).toContain('RUN_MIGRATIONS_ON_STARTUP');
    expect(deployScript.indexOf(migrationCommand)).toBeLessThan(
      deployScript.indexOf(startCommand),
    );
    expect(dockerfile).toContain('RUN_MIGRATIONS_ON_STARTUP');
    expect(dockerfile).toContain('sh scripts/migrate-deploy.sh');
    expect(dockerfile).toContain('NODE_OPTIONS=--max-old-space-size=896');
    expect(helmDeployment).toContain('sh scripts/migrate-deploy.sh');
    expect(runtimeMigrateScript).toContain('npx prisma migrate deploy');
    expect(runtimeMigrateScript).toContain('npx prisma db execute');
    expect(runtimeMigrateScript).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx"',
    );
    expect(runtimeMigrateScript).toContain(
      'CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx"',
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
    expect(script).toContain('const DEFAULT_BATCH_SIZE = 5');
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
