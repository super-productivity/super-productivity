import * as fs from 'fs';
import { join } from 'path';
import { log } from 'electron-log/main';

// Presence-based crash marker: the file exists whenever a launch is in
// flight and is removed on IPC.APP_READY. A leftover file therefore means
// the previous launch never finished booting, which on Snap/Flatpak is
// overwhelmingly a GPU-process init failure (Mesa ABI drift, missing DRI
// nodes under confinement). This file disappears again on the next
// successful launch, so there's no sticky stuck-off state — a one-off
// force-quit costs the user a single GPU-disabled launch, not permanent
// software rendering.
const MARKER_FILE = '.gpu-launch-incomplete';
// Leftovers from earlier iterations of this guard. Cleaned up on startup
// so users who ran an intermediate build don't carry stale state.
const LEGACY_MARKER_FILES = ['.gpu-startup-state', '.gpu-startup-state.json'];

const isTruthyEnv = (v: string | undefined): boolean =>
  !!v && /^(1|true|yes|on)$/i.test(v.trim());

const errCode = (e: unknown): string | undefined =>
  (e as NodeJS.ErrnoException | undefined)?.code;

export interface GpuGuardDecision {
  disableGpu: boolean;
  reason: 'env' | 'crash-recovery' | null;
  markerPath: string | null;
}

/**
 * Must run after `app.setPath('userData', ...)` and before
 * `app.whenReady()`. Only auto-detects under Snap/Flatpak confinement on
 * Linux — the failure mode this guards against is specific to confined
 * packages with drifting Mesa stacks. `SP_DISABLE_GPU` / `SP_ENABLE_GPU`
 * env vars work everywhere.
 *
 * Returns the marker path so the caller can hand it to
 * `markStartupSuccess` when the renderer signals boot completion. Holding
 * no module-level state keeps the function idempotent across calls (tests,
 * reinit) and removes a coupling that previously required runtime state
 * resets to stay consistent.
 */
export const evaluateGpuStartupGuard = (userDataPath: string): GpuGuardDecision => {
  const isConfinedLinux =
    process.platform === 'linux' && (!!process.env.SNAP || !!process.env.FLATPAK_ID);

  // Marker path is only meaningful under confinement; env-override paths
  // still need it so markStartupSuccess can clean up a stale marker left
  // by a previous (non-override) crashed launch.
  const markerPath = isConfinedLinux ? join(userDataPath, MARKER_FILE) : null;

  if (isTruthyEnv(process.env.SP_ENABLE_GPU)) {
    return { disableGpu: false, reason: null, markerPath };
  }
  if (isTruthyEnv(process.env.SP_DISABLE_GPU)) {
    return { disableGpu: true, reason: 'env', markerPath };
  }

  if (!isConfinedLinux || !markerPath) {
    return { disableGpu: false, reason: null, markerPath: null };
  }

  for (const old of LEGACY_MARKER_FILES) {
    try {
      fs.unlinkSync(join(userDataPath, old));
    } catch {
      // not present — nothing to do
    }
  }

  let previousCrash = false;
  try {
    previousCrash = fs.existsSync(markerPath);
  } catch (e) {
    log('gpu-startup-guard: failed to read marker', { code: errCode(e) });
  }

  // mkdirSync is load-bearing on first-ever install: Electron's
  // `app.setPath('userData', ...)` does NOT create the directory.
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch (e) {
    log('gpu-startup-guard: failed to create userData dir', { code: errCode(e) });
  }
  try {
    fs.writeFileSync(markerPath, '');
  } catch (e) {
    log('gpu-startup-guard: failed to write marker', { code: errCode(e) });
  }

  return {
    disableGpu: previousCrash,
    reason: previousCrash ? 'crash-recovery' : null,
    markerPath,
  };
};

/**
 * Called once the renderer signals IPC.APP_READY (after Angular boot).
 * Removes the crash marker so the next launch is treated as clean. The
 * marker path is passed explicitly by the caller rather than read from
 * module state — see `evaluateGpuStartupGuard` for the rationale.
 */
export const markStartupSuccess = (markerPath: string | null): void => {
  if (!markerPath) return;
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // Already gone, or the auto-detect path was skipped — either way we're done.
  }
};
