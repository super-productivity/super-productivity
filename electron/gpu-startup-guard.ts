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

let markerPath: string | null = null;

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
 */
export const evaluateGpuStartupGuard = (userDataPath: string): GpuGuardDecision => {
  if (isTruthyEnv(process.env.SP_ENABLE_GPU)) {
    return { disableGpu: false, reason: null, markerPath: null };
  }
  if (isTruthyEnv(process.env.SP_DISABLE_GPU)) {
    return { disableGpu: true, reason: 'env', markerPath: null };
  }

  const isConfinedLinux =
    process.platform === 'linux' && (!!process.env.SNAP || !!process.env.FLATPAK_ID);
  if (!isConfinedLinux) {
    return { disableGpu: false, reason: null, markerPath: null };
  }

  markerPath = join(userDataPath, MARKER_FILE);

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
    log('gpu-startup-guard: failed to read marker', e);
  }

  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(markerPath, '');
  } catch (e) {
    log('gpu-startup-guard: failed to write marker', e);
  }

  return {
    disableGpu: previousCrash,
    reason: previousCrash ? 'crash-recovery' : null,
    markerPath,
  };
};

/**
 * Called once the renderer signals IPC.APP_READY (after Angular boot).
 * Removes the crash marker so the next launch is treated as clean.
 */
export const markStartupSuccess = (): void => {
  if (!markerPath) return;
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // Already gone, or the auto-detect path was skipped — either way we're done.
  }
};
