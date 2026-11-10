-- Browser sign-in for new devices: the app creates a request and polls it,
-- the logged-in browser page approves it. One-shot rows, at most 10 minutes.
CREATE TABLE "connect_requests" (
  "id" TEXT PRIMARY KEY,
  "poll_secret_hash" TEXT NOT NULL,
  "match_code" TEXT NOT NULL,
  "device_name" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "user_id" INTEGER REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token_version" INTEGER,
  "expires_at" BIGINT NOT NULL
);
CREATE INDEX "connect_requests_user_id_idx" ON "connect_requests"("user_id");
CREATE INDEX "connect_requests_expires_at_idx" ON "connect_requests"("expires_at");
