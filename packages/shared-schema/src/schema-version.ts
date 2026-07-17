/**
 * Current schema version for all operations and state snapshots.
 * Increment this BEFORE adding a new migration.
 *
 * BUMP POLICY — a bump does NOT protect the released fleet. Every released
 * client from v17.0.0 through v18.14.0 tolerates ops up to schema 5 (its
 * version 2 plus the old MAX_VERSION_SKIP band of 3) and applies them
 * UNMIGRATED after one warning snack per session; at schema >= 6 it blocks,
 * but still advances the server cursor, permanently skipping the blocked ops
 * even after the user updates. Only post-v18.14.0 receivers block newer ops
 * safely (cursor frozen). Therefore new op semantics must degrade gracefully on older
 * clients (see the LwwUpdatePayload envelope pattern in packages/sync-core);
 * a change old clients would MISAPPLY must not ship behind a bump alone.
 * Full policy: docs/sync-and-op-log/operation-log-architecture.md, A.7.11
 * "Bump Policy".
 */
export const PROJECT_DELETE_WINS_SCHEMA_VERSION = 4;
export const CURRENT_SCHEMA_VERSION = PROJECT_DELETE_WINS_SCHEMA_VERSION;

/**
 * Minimum schema version that this codebase can still handle.
 * Operations below this version cannot be processed.
 */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

// NOTE: there is deliberately NO forward-compat band: any op from a NEWER
// schema version is blocked outright (the client cannot know how to interpret
// it), and the user is prompted to update the app.
