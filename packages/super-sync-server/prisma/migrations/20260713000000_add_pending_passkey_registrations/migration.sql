CREATE TABLE "pending_passkey_registrations" (
    "id" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "verification_token_expires_at" BIGINT NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "pending_passkey_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_passkey_registrations_verification_token_key"
ON "pending_passkey_registrations"("verification_token");

CREATE INDEX "pending_passkey_registrations_user_id_idx"
ON "pending_passkey_registrations"("user_id");

ALTER TABLE "pending_passkey_registrations"
ADD CONSTRAINT "pending_passkey_registrations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
