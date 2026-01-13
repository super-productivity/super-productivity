/**
 * Current schema version for all operations and state snapshots.
 * Increment this BEFORE adding a new migration.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Minimum schema version that this codebase can still handle.
 * Operations below this version cannot be processed.
 */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Maximum version difference we tolerate before forcing an app update.
 * If remote data is more than MAX_VERSION_SKIP versions ahead,
 * the user must update their app.
 */
export const MAX_VERSION_SKIP = 3;
