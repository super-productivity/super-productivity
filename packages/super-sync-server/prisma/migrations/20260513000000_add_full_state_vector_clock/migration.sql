ALTER TABLE "user_sync_state"
  ADD COLUMN "latest_full_state_seq" INTEGER,
  ADD COLUMN "latest_full_state_vector_clock" JSONB;
