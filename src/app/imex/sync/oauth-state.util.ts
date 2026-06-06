const TOKEN_STATE_VALIDITY_MS = 10 * 60 * 1000; // 10 minutes

// OAuth state storage for CSRF protection: state -> { provider, expiresAt }
const OAUTH_STATES_MAP = new Map<string, { provider: string; expiresAt: number }>();

const _pruneExpiredOAuthStates = (): void => {
  const now = Date.now();
  for (const [state, data] of OAUTH_STATES_MAP.entries()) {
    if (now > data.expiresAt) {
      OAUTH_STATES_MAP.delete(state);
    }
  }
};

/**
 * Store an OAuth state for a provider to protect against CSRF.
 */
export const addOAuthState = (provider: string, state: string): void => {
  _pruneExpiredOAuthStates();
  OAUTH_STATES_MAP.set(state, {
    provider,
    expiresAt: Date.now() + TOKEN_STATE_VALIDITY_MS,
  });
};

/**
 * Validate an OAuth state parameter against stored states for a given provider.
 * Returns true if state is valid, false otherwise.
 * Consuming the state removes it (one-time use).
 */
export const validateOAuthState = (provider: string, state: string | null): boolean => {
  _pruneExpiredOAuthStates();
  if (!state) return false;
  const stored = OAUTH_STATES_MAP.get(state);
  if (!stored || stored.provider !== provider) return false;
  OAUTH_STATES_MAP.delete(state);
  return true;
};
