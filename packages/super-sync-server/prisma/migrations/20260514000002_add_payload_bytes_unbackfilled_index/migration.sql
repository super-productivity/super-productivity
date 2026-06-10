-- Partial index over the rows the payload_bytes backfill still has to touch.
-- It only contains rows WHERE payload_bytes = 0, so as migrate-payload-bytes.ts
-- sets every row > 0 the index physically drains to empty. Post-backfill the
-- boot-time `EXISTS (SELECT 1 FROM operations WHERE payload_bytes = 0 LIMIT 1)`
-- self-check and the `BOOL_OR(payload_bytes = 0)` quota probe resolve via an
-- empty index instead of a full sequential scan that has to visit every heap
-- tuple to prove absence. Keyed (user_id, id) so the backfill's per-user
-- keyset paging (WHERE user_id = $ AND payload_bytes = 0 AND id > $lastId
-- ORDER BY id) is a true index seek rather than a re-scan from the start of
-- each user's range on every batch. Concurrent build to avoid locking writes.
DROP INDEX CONCURRENTLY IF EXISTS "operations_payload_bytes_unbackfilled_idx";
CREATE INDEX CONCURRENTLY "operations_payload_bytes_unbackfilled_idx"
  ON "operations"("user_id", "id")
  WHERE "payload_bytes" = 0;
