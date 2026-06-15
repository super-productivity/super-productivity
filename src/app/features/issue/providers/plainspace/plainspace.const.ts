export {
  PLAINSPACE_CONFIG_FORM_SECTION,
  PLAINSPACE_CONFIG_FORM,
  DEFAULT_PLAINSPACE_CFG,
} from './plainspace-cfg-form.const';

export const PLAINSPACE_POLL_INTERVAL = 5 * 60 * 1000;
export const PLAINSPACE_INITIAL_POLL_DELAY = 8 * 1000;

/**
 * Prototype flag: while true, `PlainspaceApiService` serves in-memory mock data
 * instead of making HTTP calls, so the feature is fully demonstrable without a
 * live Plainspace backend. Flip to `false` once the real API is wired up.
 * Typed as `boolean` (not the literal `true`) so the real HTTP branches don't
 * become "unreachable code".
 */
export const PLAINSPACE_USE_MOCK: boolean = true;

/** Mock identity of "me" for the prototype's assigned/unassigned split. */
export const PLAINSPACE_MOCK_CURRENT_USER_ID = 'ps-me';
