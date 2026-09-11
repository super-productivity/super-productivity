/**
 * Floor the Electron main process enforces before forwarding an idle period
 * (`sendIdleMsgIfOverMin()` in start-app.ts). On desktop a lower `minIdleTime`
 * is not disabled, it is silently rounded up — the dialog opens at ~1–1.5 min
 * regardless — which is what the settings bound exists to make visible. Shared
 * with the frontend so that bound cannot drift from the enforced value. #9349
 *
 * ⚠️ Not only the forwarding floor: `IdleTimeHandler` reuses it as the Wayland
 * helper's `--timeout-ms` and as the `_waylandIdleSinceMs` backfill offset, so
 * lowering it to relax the settings bound would also retune Wayland idle
 * detection.
 */
export const IDLE_MIN_IDLE_TIME_MS = 60000;

/**
 * How often the main process samples the system idle time. Detection therefore
 * lags the configured threshold by up to this much.
 */
export const IDLE_PING_INTERVAL_MS = 30000;
