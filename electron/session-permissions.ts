/**
 * Web permissions the main window's session grants; everything else (webcam,
 * microphone, geolocation, clipboard read, …) is denied.
 *
 * - `notifications`: desktop reminders.
 * - `clipboard-sanitized-write`: `navigator.clipboard.writeText()`, used e.g.
 *   by Ctrl/Cmd+C on a focused task (markdown checklist) and the worklog
 *   export. Without it every such write rejects with NotAllowedError. It only
 *   allows writing sanitized data; reading the clipboard stays denied.
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'notifications',
  'clipboard-sanitized-write',
]);

export const isAllowedSessionPermission = (permission: string): boolean =>
  ALLOWED_PERMISSIONS.has(permission);
