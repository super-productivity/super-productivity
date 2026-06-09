-- Add magic-link login token fields to users.
--
-- These columns and index exist in schema.prisma and are used at runtime by
-- src/auth.ts (requestLoginMagicLink / verifyLoginMagicLink), but no migration
-- ever created them, so a database built purely from migrations was missing
-- them and magic-link login failed with:
--   The column `users.login_token` does not exist in the current database.
-- See issue #8187.
--
-- IF NOT EXISTS keeps this safe on databases that already gained these columns
-- via `prisma db push` (e.g. installs baselined that way), so no per-deployment
-- `migrate resolve` is needed.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_token" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_token_expires_at" BIGINT;

-- Create index for efficient token lookup
CREATE INDEX IF NOT EXISTS "users_login_token_idx" ON "users"("login_token");
