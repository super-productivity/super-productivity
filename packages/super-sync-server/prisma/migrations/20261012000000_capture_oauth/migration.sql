ALTER TABLE "capture_grants"
  ADD COLUMN "client_id" TEXT,
  ADD COLUMN "resource" TEXT,
  ADD COLUMN "refresh_hash" TEXT,
  ADD COLUMN "prev_refresh_hash" TEXT,
  ADD COLUMN "rotated_at" BIGINT,
  ADD COLUMN "refresh_expires_at" BIGINT;

CREATE TABLE "capture_connect_codes" (
  "user_id" INTEGER PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code_hash" TEXT NOT NULL UNIQUE,
  "token_version" INTEGER NOT NULL,
  "expires_at" BIGINT NOT NULL
);
CREATE TABLE "capture_auth" (
  "id" TEXT PRIMARY KEY,
  "user_id" INTEGER REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "client_id" TEXT NOT NULL,
  "client_name" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "code_challenge" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "code_hash" TEXT UNIQUE,
  "token_version" INTEGER,
  "expires_at" BIGINT NOT NULL
);
CREATE INDEX "capture_auth_user_id_idx" ON "capture_auth"("user_id");
CREATE INDEX "capture_auth_expires_at_idx" ON "capture_auth"("expires_at");
