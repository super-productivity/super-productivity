/**
 * Entity Types for distributed synchronization.
 *
 * These are the valid entity types for operations in the sync system.
 * Shared between client and server to ensure consistency.
 *
 * IMPORTANT: This module is shared between client and server.
 * Any changes must be compatible with both environments.
 */

/**
 * Valid entity types for operations.
 * Operations with unknown entity types will be rejected by the server.
 */
export const ENTITY_TYPES = [
  'TASK',
  'PROJECT',
  'TAG',
  'NOTE',
  'GLOBAL_CONFIG',
  'SIMPLE_COUNTER',
  'WORK_CONTEXT',
  'TIME_TRACKING',
  'TASK_REPEAT_CFG',
  'ISSUE_PROVIDER',
  'PLANNER',
  'MENU_TREE',
  'METRIC',
  'BOARD',
  'REMINDER',
  'PLUGIN_USER_DATA',
  'PLUGIN_METADATA',
  'MIGRATION',
  'RECOVERY', // For disaster recovery imports
  'ALL', // For full state imports (sync, backup)
] as const;

/**
 * Entity type - identifies the kind of data entity being operated on.
 * Derived from ENTITY_TYPES array for single source of truth.
 */
export type EntityType = (typeof ENTITY_TYPES)[number];
