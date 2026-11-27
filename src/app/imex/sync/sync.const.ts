export const SYNC_INITIAL_SYNC_TRIGGER = 'INITIAL_SYNC_TRIGGER';
export const SYNC_DEFAULT_AUDIT_TIME = 10000;

export const SYNC_BEFORE_GOING_TO_SLEEP_THROTTLE_TIME = 1000 * 60 * 5;

export const SYNC_BEFORE_CLOSE_ID = 'SYNC_BEFORE_CLOSE_ID';
export const SYNC_MIN_INTERVAL = 5000;

/**
 * Maximum time to wait for an ongoing sync to complete before considering it timed out.
 * Used by `afterCurrentSyncDoneOrSyncDisabled$` to prevent indefinite waiting.
 * Set to 90s to exceed all server-side timeouts:
 * - Caddy proxy: 85s
 * - Fastify server: 80s
 * - HTTP fetch: 75s
 * - Database operations: 60s
 */
export const SYNC_WAIT_TIMEOUT_MS = 90000;

/**
 * Delay before triggering the initial sync for SuperSync provider.
 * This allows the UI to render and become interactive first.
 * Only applies to SuperSync because:
 * - SuperSync uses operation-based sync where data is already local
 * - Other providers (Dropbox, WebDAV, LocalFile) may need to download data before user can work
 */
export const INITIAL_SYNC_DELAY_MS = 500;
