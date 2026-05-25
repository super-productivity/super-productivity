export const SYNC_DEBOUNCE_MS = 500;
export const SYNC_DEBOUNCE_MS_UNFOCUSED = 15000; // 15 seconds when SP is not focused
export const SYNC_DEBOUNCE_MS_MD_TO_SP = 10000; // 10 seconds for MD to SP sync
export const FILE_WATCH_POLL_INTERVAL_MS = 2000;

// Cooldown after MD→SP sync to suppress SP hooks that fire as side-effects
// of the batch update. Must be > SYNC_DEBOUNCE_MS to outlast the debounce window.
export const SP_HOOK_COOLDOWN_MS = 2000;
