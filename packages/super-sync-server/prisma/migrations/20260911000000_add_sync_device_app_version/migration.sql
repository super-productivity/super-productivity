-- Client-reported app version per device (#9962). Automatic full-state
-- checkpoints are only safe for an account once every client that still syncs
-- it runs a release whose REPAIR handling keeps concurrent edits (v18.21.2+);
-- this column is what the gate reads (src/sync/checkpoint-gate.ts).
--
-- Nullable, no default: ADD COLUMN without a default is a catalog-only change
-- on PostgreSQL (no table rewrite, no backfill). sync_devices is small (one
-- row per device inside retention), so no CONCURRENTLY shape is needed either.
-- Devices that never report a version keep NULL and count as old.
ALTER TABLE "sync_devices" ADD COLUMN "app_version" TEXT;
