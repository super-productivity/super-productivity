-- AlterTable: Make passwordHash nullable for passkey-only users
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AlterTable: Add passkey recovery fields to users
ALTER TABLE "users" ADD COLUMN "passkey_recovery_token" TEXT;
ALTER TABLE "users" ADD COLUMN "passkey_recovery_token_expires_at" BIGINT;

-- CreateIndex for passkey recovery token
CREATE INDEX "users_passkey_recovery_token_idx" ON "users"("passkey_recovery_token");

-- CreateTable: passkeys
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique credential_id
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex: user_id for lookups
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
