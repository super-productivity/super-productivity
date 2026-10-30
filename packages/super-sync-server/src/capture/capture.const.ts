import { MS_PER_DAY } from '../sync/sync.types';

/**
 * Limits of agent task capture (docs/plans/2026-10-11-agent-task-capture.md).
 * The tool limits are a public contract once shipped: loosening is
 * compatible, tightening is not.
 */
export const CAPTURE_TITLE_MAX_CHARS = 500;
export const CAPTURE_NOTES_MAX_BYTES = 8 * 1024;
export const CAPTURE_REPEAT_EVERY_MAX = 99;
/** Room for JSON escaping: 8 KiB of notes can more than double as `\uXXXX`. */
export const CAPTURE_MCP_BODY_LIMIT_BYTES = 64 * 1024;

export const CAPTURE_MCP_CALLS_PER_MINUTE = 30;
/** Per IP; generous because a vendor egress IP serves many users. */
export const CAPTURE_MCP_AUTH_FAILURES_PER_MINUTE = 120;
export const CAPTURE_MAX_PENDING_PER_GRANT = 200;
/** New tasks per grant per day; bounds what a leaked or misled assistant adds. */
export const CAPTURE_MAX_CREATES_PER_GRANT_PER_DAY = 200;
export const CAPTURE_MAX_PENDING_PER_USER = 500;

export const CAPTURE_CLAIM_BATCH_SIZE = 50;

/**
 * Pre-sealed items from the app's own devices (Android share,
 * docs/plans/2026-10-24-android-share-capture.md). Not a row in
 * capture_grants: never listed or revoked as a grant, dropped by switch-off
 * and key replacement like every item.
 */
export const CAPTURE_APP_SHARE_GRANT_ID = 'app-share';
/** Decoded seal size; the worst-case share payload seals to about 13 KB. */
export const CAPTURE_SEALED_MAX_BYTES = 32 * 1024;
export const CAPTURE_ITEMS_BODY_LIMIT_BYTES = 48 * 1024;
export const CAPTURE_LEASE_MS = MS_PER_DAY;
export const CAPTURE_RETRY_WINDOW_MS = 10 * 60 * 1000;
export const CAPTURE_TOKEN_TTL_MS = 365 * MS_PER_DAY;

export const CAPTURE_CLIENT_NAME_MAX_CHARS = 100;
export const CAPTURE_DEVICE_ID_MAX_CHARS = 100;

export const CAPTURE_TOKEN_PREFIX = 'sp_cap_';

export const CAPTURE_SAVED_TEXT =
  'Saved. It will appear in your Super Productivity Inbox the next time the app syncs.';
export const CAPTURE_SWITCHED_OFF_TEXT =
  'AI capture is switched off in Super Productivity.';
export const CAPTURE_REVOKED_TEXT = 'This connection was removed in Super Productivity.';
export const CAPTURE_DAILY_LIMIT_TEXT =
  'This connection reached its daily limit of new tasks. Try again tomorrow.';
export const CAPTURE_QUEUE_FULL_TEXT =
  'Your capture queue is full. Open the app to sync.';
