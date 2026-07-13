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

-- Move credentials created by the legacy registration flow out of the active
-- passkey set. The most recently created credential is the one associated with
-- the user's current verification token because re-registration replaced the
-- previous credential before rotating that token.
INSERT INTO "pending_passkey_registrations" (
    "id",
    "verification_token",
    "verification_token_expires_at",
    "credential_id",
    "public_key",
    "counter",
    "transports",
    "created_at",
    "user_id"
)
SELECT DISTINCT ON (p."user_id")
    'legacy-' || p."id",
    u."verification_token",
    u."verification_token_expires_at",
    p."credential_id",
    p."public_key",
    p."counter",
    p."transports",
    p."created_at",
    p."user_id"
FROM "passkeys" p
JOIN "users" u ON u."id" = p."user_id"
WHERE u."is_verified" = 0
  AND u."verification_token" IS NOT NULL
  AND u."verification_token_expires_at" IS NOT NULL
ORDER BY p."user_id", p."created_at" DESC, p."id" DESC
ON CONFLICT ("verification_token") DO NOTHING;

DELETE FROM "passkeys" p
USING "users" u
WHERE u."id" = p."user_id"
  AND u."is_verified" = 0;
