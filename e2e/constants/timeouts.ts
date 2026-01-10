/**
 * Standardized timeout constants for e2e tests.
 * Use these to ensure consistent timeout handling across all tests.
 */
export const TIMEOUTS = {
  /** Standard wait for dialogs to appear/disappear */
  DIALOG: 5000,

  /** Standard wait for navigation changes */
  NAVIGATION: 30000,

  /** Wait for sync operations to complete */
  SYNC: 30000,

  /** Maximum wait for scheduled reminders to trigger */
  SCHEDULE_MAX: 60000,

  /** Wait for tasks to become visible */
  TASK_VISIBLE: 10000,

  /** Wait for UI animations to complete */
  ANIMATION: 500,

  /** Wait for Angular stability after state changes */
  ANGULAR_STABILITY: 3000,

  /** Wait for elements to be enabled/clickable */
  ELEMENT_ENABLED: 5000,

  /** Extended timeout for complex operations */
  EXTENDED: 20000,
} as const;

export type TimeoutKey = keyof typeof TIMEOUTS;
