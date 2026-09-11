-- The covering (user_id, received_at, server_seq) index created by the
-- previous migration serves every (user_id, received_at) query via its prefix,
-- so the 2-col original is pure write amplification on the hottest table.
--
-- Single statement on purpose: Prisma applies a one-statement migration
-- without a transaction wrap, so this runs natively under
-- `prisma migrate deploy` (no out-of-band recovery involved), and IF EXISTS
-- makes a re-run safe. Kept separate from the create so the covering index is
-- committed-and-valid before the fallback disappears.
DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_received_at_idx";
