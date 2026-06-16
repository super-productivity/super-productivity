-- GIN index for #8334 multi-entity conflict detection.
--
-- The latest-writer lookups match a requested entity id against entity_ids
-- (entity_ids @> ARRAY[id] / entity_ids && ARRAY[...]). A GIN index on the array
-- lets those match without scanning a user's operation history.
--
-- Single-statement CREATE INDEX CONCURRENTLY: `prisma migrate deploy` applies it
-- natively because PostgreSQL does not wrap a single statement in an implicit
-- transaction (CONCURRENTLY is forbidden inside a transaction). See
-- prisma/migrations/README.md.
--
-- Avoid name-only idempotency: an interrupted concurrent build leaves an INVALID
-- index with this name, which must fail loudly and be rebuilt rather than be
-- silently skipped (matching the 20260511000000 precedent). Pre-migration rows
-- have an empty entity_ids array; the conflict lookups fall back to the scalar
-- entity_id (served by the existing
-- operations_user_id_entity_type_entity_id_server_seq index), so no data backfill
-- is needed for this index to be correct.
CREATE INDEX CONCURRENTLY "operations_entity_ids_gin"
  ON "operations" USING GIN ("entity_ids");
