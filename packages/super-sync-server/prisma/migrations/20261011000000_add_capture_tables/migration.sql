-- Agent task capture (docs/plans/2026-10-11-agent-task-capture.md). New, empty
-- tables only: nothing existing is rewritten or backfilled.
CREATE TABLE "capture_keys" (
    "user_id" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "disabled_at" BIGINT,

    CONSTRAINT "capture_keys_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "capture_grants" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "last_used_at" BIGINT,
    "revoked_at" BIGINT,

    CONSTRAINT "capture_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capture_items" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "grant_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "lease_device_id" TEXT,
    "lease_until" BIGINT,

    CONSTRAINT "capture_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "capture_grants_user_id_idx" ON "capture_grants"("user_id");

CREATE INDEX "capture_items_user_id_created_at_idx" ON "capture_items"("user_id", "created_at");

CREATE INDEX "capture_items_grant_id_idx" ON "capture_items"("grant_id");

ALTER TABLE "capture_keys" ADD CONSTRAINT "capture_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_grants" ADD CONSTRAINT "capture_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_items" ADD CONSTRAINT "capture_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
