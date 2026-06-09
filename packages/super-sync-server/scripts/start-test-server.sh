#!/bin/sh
set -u

create_test_partial_indexes() {
  # `prisma db push` cannot express PostgreSQL partial indexes from schema.prisma.
  # Mirror the production migration index required by the startup self-check.
  npx prisma db execute --stdin --schema prisma/schema.prisma <<'SQL'
CREATE INDEX IF NOT EXISTS "operations_user_id_full_state_server_seq_idx"
  ON "operations"("user_id", "server_seq")
  WHERE "op_type" IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR');
SQL
}

for i in $(seq 1 15); do
  if npx prisma db push && create_test_partial_indexes; then
    exec node dist/src/index.js
  fi

  echo "prisma test schema setup failed (attempt $i/15), retrying in 2s..."
  sleep 2
done

echo "prisma test schema setup failed after 15 attempts, giving up" >&2
exit 1
