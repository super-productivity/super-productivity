-- Baseline migration: the schema as it existed before the first incremental
-- migration (20251212000000_add_is_payload_encrypted). Every existing migration
-- only ALTERs these tables, so without this baseline a fresh database cannot be
-- created from the migration chain (the first migration ALTERs a non-existent
-- "operations" table). See issue #8187.
--
-- This intentionally recreates the OLD shape (password_hash NOT NULL,
-- operations.parent_op_id, the tombstones table, no storage-quota / reset-token
-- / passkey / login-token columns). Later migrations bring it up to date, so do
-- NOT add newer columns here, and do NOT regenerate this from the current
-- schema.prisma. It is equivalent to
--   prisma migrate diff --from-empty \
--     --to-schema-datamodel <schema.prisma as of the first migration> --script
--
-- EXISTING deployments whose schema predates this file must mark the already-
-- present migrations as applied before their next deploy, so migrate deploy does
-- not try to recreate existing objects. See the "Existing databases created
-- before the 0_init baseline" note in README.md for the exact commands (it
-- differs for db-push installs vs. installs with prior migration history).

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_verified" INTEGER NOT NULL DEFAULT 0,
    "verification_token" TEXT,
    "verification_token_expires_at" BIGINT,
    "verification_resend_count" INTEGER NOT NULL DEFAULT 0,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" BIGINT,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "terms_accepted_at" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "client_id" TEXT NOT NULL,
    "server_seq" INTEGER NOT NULL,
    "action_type" TEXT NOT NULL,
    "op_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL,
    "vector_clock" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "client_timestamp" BIGINT NOT NULL,
    "received_at" BIGINT NOT NULL,
    "parent_op_id" TEXT,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sync_state" (
    "user_id" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_snapshot_seq" INTEGER,
    "snapshot_data" BYTEA,
    "snapshot_at" BIGINT,
    "snapshot_schema_version" INTEGER DEFAULT 1,

    CONSTRAINT "user_sync_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sync_devices" (
    "client_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "device_name" TEXT,
    "user_agent" TEXT,
    "last_seen_at" BIGINT NOT NULL,
    "last_acked_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "sync_devices_pkey" PRIMARY KEY ("user_id","client_id")
);

-- CreateTable
CREATE TABLE "tombstones" (
    "user_id" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "deleted_at" BIGINT NOT NULL,
    "deleted_by_op_id" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,

    CONSTRAINT "tombstones_pkey" PRIMARY KEY ("user_id","entity_type","entity_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_verification_token_idx" ON "users"("verification_token");

-- CreateIndex
CREATE UNIQUE INDEX "operations_user_id_server_seq_key" ON "operations"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "operations_user_id_server_seq_idx" ON "operations"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "operations_user_id_entity_type_entity_id_idx" ON "operations"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "operations_user_id_client_id_idx" ON "operations"("user_id", "client_id");

-- CreateIndex
CREATE INDEX "operations_user_id_received_at_idx" ON "operations"("user_id", "received_at");

-- CreateIndex
CREATE INDEX "tombstones_expires_at_idx" ON "tombstones"("expires_at");

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sync_state" ADD CONSTRAINT "user_sync_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tombstones" ADD CONSTRAINT "tombstones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
