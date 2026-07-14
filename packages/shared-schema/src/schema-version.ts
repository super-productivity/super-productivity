/**
 * Current schema version for all operations and state snapshots.
 * Increment this BEFORE adding a new migration.
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
