-- Add an index that satisfies conflict detection's latest-entity-op query.
-- Keep the existing entity lookup index so this migration is additive.
-- Avoid name-only idempotency here: interrupted concurrent builds can leave an
-- invalid index with the same name, which should fail loudly instead of being
-- marked as an applied migration.
CREATE INDEX CONCURRENTLY "operations_user_id_entity_type_entity_id_server_seq_idx"
  ON "operations"("user_id", "entity_type", "entity_id", "server_seq");
