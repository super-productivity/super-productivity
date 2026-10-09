/**
 * E2E Test Constants
 *
 * Centralized magic numbers for E2E tests to ensure consistency
 * and make timeouts/delays easy to tune.
 */

// ============================================================================
// UI Element Visibility Timeouts
// ============================================================================

/** Default timeout for waiting for UI elements to become visible */
export const UI_VISIBLE_TIMEOUT = 5000;

/** Extended timeout for elements that may take longer (dialogs, navigation) */
export const UI_VISIBLE_TIMEOUT_LONG = 10000;

/** Short timeout for quick visibility checks */
export const UI_VISIBLE_TIMEOUT_SHORT = 2000;

// ============================================================================
// UI Settle Delays
// ============================================================================

/** Small delay after actions for animations/UI to settle */
export const UI_SETTLE_SMALL = 200;

/** Standard delay after significant UI changes */
export const UI_SETTLE_STANDARD = 500;

/** Extended delay after major operations (navigation, sync) */
export const UI_SETTLE_EXTENDED = 1000;

// ============================================================================
// Network/API Timeouts
// ============================================================================

/** Timeout for health check requests */
export const HEALTH_CHECK_TIMEOUT = 2000;

/** Timeout for API requests */
export const API_REQUEST_TIMEOUT = 3000;

// ============================================================================
// Retry Configuration
// ============================================================================

/** Base delay for exponential backoff (ms) */
export const RETRY_BASE_DELAY = 1000;

// ============================================================================
// Sync Test Constants
// ============================================================================

/** Polling interval for waiting for tasks (reduced from 300ms) */
export const TASK_POLL_INTERVAL = 150;

/** Default timeout for waiting for a task to appear */
export const TASK_WAIT_TIMEOUT = 30000;
