-- Speed up latest/oldest full-state operation lookups without adding write
-- cost for regular operations.
-- Drop first so a rerun can recover from a failed CONCURRENTLY build that left
-- an INVALID index behind.
DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_full_state_server_seq_idx";
CREATE INDEX CONCURRENTLY "operations_user_id_full_state_server_seq_idx"
  ON "operations"("user_id", "server_seq")
  WHERE "op_type" IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR');

-- Remove redundant indexes while reducing write amplification on the hot table.
-- Restore-point op_type lookups are covered by the partial index above; add a
-- targeted index if future code filters by other op_type values.
DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_op_type_idx";
DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_entity_type_entity_id_idx";
DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_idx";
