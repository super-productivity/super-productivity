/**
 * Current schema version for all operations and state snapshots.
 *
 * DO NOT BUMP THIS LIGHTLY — default is to NOT bump. A bump is a near-one-way
 * fence: it hard-blocks every not-yet-updated post-v18.14.0 client (frozen
 * cursor) on the new ops, and it CANNOT be reverted once any op carries the new
 * version — a reverted client hard-blocks on the v(N+1) ops it already wrote and
 * the USE_REMOTE recovery path throws on them. So a bump must earn its cost. If
 * old clients can apply the op unmigrated, gate the new semantics on a payload
 * marker / envelope (see LwwUpdatePayload in packages/sync-core) and LEAVE THIS
 * CONSTANT ALONE. Only bump when a change genuinely requires it: a transforming
 * migration (renamed/removed field, dropped op) or a semantic you must hard-fence
 * off older clients. Cautionary example — v4 (#9009 project delete-wins) was
 * bumped for a marker-only change old clients degrade on fine: it needed no bump,
 * yet it now fences every lagging post-v18.14.0 client. Then, and only then,
 * increment this BEFORE adding the new migration.
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
