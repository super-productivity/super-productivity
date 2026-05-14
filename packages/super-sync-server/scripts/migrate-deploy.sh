#!/bin/sh
set -eu

FULL_STATE_INDEX_MIGRATION="20260512000000_add_full_state_sequence_index_drop_redundant_indexes"
ENCRYPTED_OPS_INDEX_MIGRATION="20260514000000_add_encrypted_ops_partial_index"

MIGRATE_LOG=""
MIGRATE_STATUS=0

run_migrate_deploy() {
  MIGRATE_LOG="$(mktemp "${TMPDIR:-/tmp}/supersync-migrate.XXXXXX")"
  set +e
  npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1
  MIGRATE_STATUS=$?
  set -e
  cat "$MIGRATE_LOG"
}

log_mentions() {
  grep -q "$1" "$MIGRATE_LOG"
}

is_recoverable_migration_failure() {
  [ -n "$MIGRATE_LOG" ] &&
    grep -Eq 'P3009|P3018' "$MIGRATE_LOG" &&
    log_mentions "$1"
}

run_sql() {
  printf '%s\n' "$1" | npx prisma db execute --schema prisma/schema.prisma --stdin
}

resolve_rolled_back() {
  npx prisma migrate resolve --rolled-back "$1"
}

resolve_applied() {
  npx prisma migrate resolve --applied "$1"
}

apply_full_state_index_migration() {
  echo "Applying $FULL_STATE_INDEX_MIGRATION outside Prisma migrate..."
  run_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_full_state_server_seq_idx";'
  run_sql 'CREATE INDEX CONCURRENTLY "operations_user_id_full_state_server_seq_idx" ON "operations"("user_id", "server_seq") WHERE "op_type" IN ('\''SYNC_IMPORT'\'', '\''BACKUP_IMPORT'\'', '\''REPAIR'\'');'
  run_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_op_type_idx";'
  run_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_entity_type_entity_id_idx";'
  run_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_idx";'
}

apply_encrypted_ops_index_migration() {
  echo "Applying $ENCRYPTED_OPS_INDEX_MIGRATION outside Prisma migrate..."
  run_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx";'
  run_sql 'CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx" ON "operations"("user_id", "server_seq") WHERE "is_payload_encrypted" = true;'
}

recover_index_migration() {
  migration="$1"

  set +e
  resolve_rolled_back "$migration"
  resolve_status=$?
  set -e
  if [ "$resolve_status" -ne 0 ]; then
    echo "Migration $migration was not in a failed state; continuing with out-of-band SQL."
  fi

  case "$migration" in
    "$FULL_STATE_INDEX_MIGRATION")
      apply_full_state_index_migration
      ;;
    "$ENCRYPTED_OPS_INDEX_MIGRATION")
      apply_encrypted_ops_index_migration
      ;;
    *)
      echo "Unknown migration: $migration"
      exit 1
      ;;
  esac

  resolve_applied "$migration"
}

run_migrate_deploy

if [ "$MIGRATE_STATUS" -ne 0 ] &&
  is_recoverable_migration_failure "$FULL_STATE_INDEX_MIGRATION"; then
  recover_index_migration "$FULL_STATE_INDEX_MIGRATION"
  run_migrate_deploy
fi

if [ "$MIGRATE_STATUS" -ne 0 ] &&
  is_recoverable_migration_failure "$ENCRYPTED_OPS_INDEX_MIGRATION"; then
  recover_index_migration "$ENCRYPTED_OPS_INDEX_MIGRATION"
  run_migrate_deploy
fi

if [ "$MIGRATE_STATUS" -ne 0 ]; then
  echo "prisma migrate deploy failed (exit $MIGRATE_STATUS)."
  exit "$MIGRATE_STATUS"
fi
