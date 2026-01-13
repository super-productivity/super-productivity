-- AlterTable
ALTER TABLE "users" ADD COLUMN "storage_quota_bytes" BIGINT NOT NULL DEFAULT 104857600;
ALTER TABLE "users" ADD COLUMN "storage_used_bytes" BIGINT NOT NULL DEFAULT 0;
