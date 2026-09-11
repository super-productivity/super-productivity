-- Avoid accumulating a large pending list on an index dominated by empty arrays.
-- The short timeout prevents the required index lock from queueing normal traffic.
SET LOCAL lock_timeout = '1s';
ALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);
