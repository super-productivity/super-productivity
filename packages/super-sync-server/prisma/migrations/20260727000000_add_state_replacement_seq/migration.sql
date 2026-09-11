-- Persist the latest state-replacing boundary independently from REPAIR
-- snapshots. Incremental uploads use this cursor to prove they have downloaded
-- the latest SYNC_IMPORT/BACKUP_IMPORT before writing.
ALTER TABLE "user_sync_state"
  ADD COLUMN "latest_state_replacement_seq" INTEGER;
