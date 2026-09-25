-- Covering replacement for operations_user_id_received_at_idx (#9692).
--
-- The old-ops sweep's fresh-prefix probe (storage-quota.service.ts) walks the
-- (user_id, received_at) index for its NO answer: every op inside the
-- retention window, each costing a random heap fetch just to evaluate
-- `server_seq < boundary`, because server_seq is not in the index. Production
-- measured five users' probes cancelled at the 60s statement_timeout (57014,
-- findFirst) on exactly that walk, on a host with ~9.5ms cold random reads.
--
-- With server_seq as a trailing key column the probe qualifies for an
-- index-only scan: the server_seq filter is answered from the index tuple, so
-- a NO answer costs index pages rather than one heap page per fresh op (heap
-- visits remain only for pages not yet all-visible). received_at ordering
-- under a user_id equality is unchanged — server_seq trails — so the probe's
-- ORDER BY received_at tie-break keeps its LIMIT-1 pushdown, and every other
-- (user_id, received_at) query is served by the prefix.
--
-- Drop-then-create (the recoverable shape, see prisma/migrations/README.md):
-- an interrupted concurrent build leaves an INVALID index that a re-run must
-- rebuild, not skip. The legacy 2-col index is dropped in the NEXT migration,
-- so probe traffic keeps a servable index through every intermediate state.
DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_received_at_server_seq_idx";
CREATE INDEX CONCURRENTLY "operations_user_id_received_at_server_seq_idx"
  ON "operations"("user_id", "received_at", "server_seq");
