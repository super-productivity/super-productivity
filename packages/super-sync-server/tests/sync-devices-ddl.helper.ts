/**
 * Postgres DDL for `sync_devices`, transcribed from `prisma/schema.prisma`
 * (`model SyncDevice`). Shared by every PGlite spec that runs shipped SQL
 * against the table so there is exactly ONE transcription to keep in sync —
 * two independently hand-written copies had already drifted from each other.
 * If a Prisma migration changes the model, update this string with it.
 */
export const SYNC_DEVICES_DDL = `
  CREATE TABLE sync_devices (
    client_id      text NOT NULL,
    user_id        integer NOT NULL,
    device_name    text,
    user_agent     text,
    last_seen_at   bigint NOT NULL,
    last_acked_seq integer NOT NULL DEFAULT 0,
    created_at     bigint NOT NULL,
    PRIMARY KEY (user_id, client_id)
  );
`;
