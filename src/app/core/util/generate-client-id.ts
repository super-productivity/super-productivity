/**
 * Pure client-ID generation and format validation.
 *
 * Extracted from ClientIdService so destructive-flow callers (clean-slate,
 * backup-restore) can mint an id without going through the stateful service —
 * the new id is persisted only inside the atomic SUP_OPS transaction in
 * OperationLogStoreService.runDestructiveStateReplacement. See issue #7732.
 *
 * No DI, no I/O — directly unit-testable.
 */

/**
 * Returns a single-character platform identifier for compact client IDs.
 * B = Browser, E = Electron, A = Android, I = iOS.
 */
const _getEnvironmentId = (): string => {
  // Detect Electron
  const isElectron =
    typeof process !== 'undefined' &&
    !!(process as { versions?: { electron?: string } }).versions?.electron;
  if (isElectron) {
    return 'E';
  }

  // Detect Android WebView
  if (/Android/.test(navigator.userAgent) && /wv/.test(navigator.userAgent)) {
    return 'A';
  }

  // Detect iOS
  if (
    navigator.userAgent.includes('iOS') ||
    navigator.userAgent.includes('iPhone') ||
    navigator.userAgent.includes('iPad')
  ) {
    return 'I';
  }

  // Default: Browser
  return 'B';
};

/**
 * Generates a random base62 string of the specified length.
 * Uses crypto.getRandomValues() for non-predictable randomness.
 */
const _generateBase62 = (length: number): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

/**
 * Generates a compact client ID: {platform}_{4-char-base62}, e.g. "B_a7Kx".
 */
export const generateClientId = (): string => {
  return `${_getEnvironmentId()}_${_generateBase62(4)}`;
};

/**
 * Type guard: true if `id` matches a known valid client-ID format.
 * - Legacy format: any string of length >= 10 (legacy IDs).
 * - New format: {platform}_{4-char-base62}, e.g. "B_a7Kx".
 *
 * Used to narrow `unknown` values read from IndexedDB. An invalid format is
 * treated as "absent" rather than fatal — see issue #6197.
 */
export const isValidClientIdFormat = (id: unknown): id is string => {
  return (
    typeof id === 'string' && (id.length >= 10 || /^[BEAI]_[a-zA-Z0-9]{4}$/.test(id))
  );
};
