import { IDB_OPEN_RETRIES, IDB_OPEN_RETRY_BASE_DELAY_MS } from './operation-log.const';

describe('IndexedDB open retry configuration', () => {
  it('should have a total retry window of at least 20 seconds to handle session-restart file locks', () => {
    // On Linux desktop environments (especially Flatpak), logging out and back
    // in with autostart can leave the old session's LevelDB lock held for 5-15+
    // seconds. The retry window must be long enough to outlast this.
    // See: https://github.com/super-productivity/super-productivity/issues/7191
    let totalDelayMs = 0;
    for (let i = 1; i <= IDB_OPEN_RETRIES; i++) {
      totalDelayMs += IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, i - 1);
    }
    expect(totalDelayMs).toBeGreaterThanOrEqual(20000);
  });
});
