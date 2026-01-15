-- AddPasswordResetToken
-- Add password reset token fields to users table

ALTER TABLE "users" ADD COLUMN "reset_password_token" TEXT;
ALTER TABLE "users" ADD COLUMN "reset_password_token_expires_at" BIGINT;

-- Create index for efficient token lookup
CREATE INDEX "users_reset_password_token_idx" ON "users"("reset_password_token");
