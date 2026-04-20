import * as fs from 'fs';
import { join } from 'path';
import { warn } from 'electron-log/main';

// Content-based crash marker: a JSON-encoded `{ ts, electronVersion }` is
// written whenever a launch is in flight and removed on IPC.APP_READY.
// A leftover file therefore means the previous launch never finished
// booting, which on Snap/Flatpak is overwhelmingly a GPU-process init
// failure (Mesa/libgbm ABI drift against the core22 snap runtime, missing
// DRI nodes under confinement). The marker is ignored if older than
// STALE_THRESHOLD_MS (suspend/SIGKILL false-negatives) or if the Electron
// version has changed since it was written (stale marker from a previous
// build should not trigger recovery).
const MARKER_FILE = '.gpu-launch-incomplete';
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
// Leftovers from earlier iterations of this guard. Cleaned up on startup
// so users who ran an intermediate build don't carry stale state.
const LEGACY_MARKER_FILES = ['.gpu-startup-state', '.gpu-startup-state.json'];

const isTruthyEnv = (v: string | undefined): boolean =>
  !!v && /^(1|true|yes|on)$/i.test(v.trim());

interface MarkerContent {
  ts: number;
  electronVersion: string;
}

const readMarker = (path: string): MarkerContent | null => {
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn('gpu-startup-guard: failed to read marker', e);
    }
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MarkerContent>;
    if (typeof parsed?.ts !== 'number' || typeof parsed?.electronVersion !== 'string') {
      return null;
    }
    return { ts: parsed.ts, electronVersion: parsed.electronVersion };
  } catch {
    return null;
  }
};

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
  const isConfinedLinux =
    process.platform === 'linux' && (!!process.env.SNAP || !!process.env.FLATPAK_ID);

  // Set the module-level marker path unconditionally on confined Linux so
  // `markGpuStartupSuccess` can clean up a stale marker even when this
  // launch took an env-var override path and never checked it.
  if (isConfinedLinux) {
    markerPath = join(userDataPath, MARKER_FILE);
  }

  if (isTruthyEnv(process.env.SP_ENABLE_GPU)) {
    return { disableGpu: false, reason: null, markerPath };
  }
  if (isTruthyEnv(process.env.SP_DISABLE_GPU)) {
    return { disableGpu: true, reason: 'env', markerPath };
  }

  if (!isConfinedLinux) {
    // Reset module-level state so a second call (tests, reinit) doesn't
    // leak a previous confined-launch's path into markGpuStartupSuccess().
    markerPath = null;
    return { disableGpu: false, reason: null, markerPath: null };
  }

  // Narrow markerPath for fs calls below — it was set on the
  // isConfinedLinux branch above, but TS can't track module-let
  // assignment across the early returns.
  const activeMarker: string = markerPath as string;

  for (const old of LEGACY_MARKER_FILES) {
    try {
      fs.unlinkSync(join(userDataPath, old));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        warn('gpu-startup-guard: failed to remove legacy marker', e);
      }
    }
  }

  // A leftover marker only counts as a previous crash if it's recent AND
  // matches the current Electron version. Older / mismatched markers are
  // treated as "clean" — a crash from a different Electron or from more
  // than STALE_THRESHOLD_MS ago is almost certainly a systemd SIGKILL,
  // suspend-mid-boot, or post-upgrade residue, not a GPU init loop.
  const marker = readMarker(activeMarker);
  const previousCrash =
    marker !== null &&
    Date.now() - marker.ts < STALE_THRESHOLD_MS &&
    marker.electronVersion === process.versions.electron;

  // mkdirSync is load-bearing on first-ever install: Electron's
  // `app.setPath('userData', ...)` does NOT create the directory, so
  // $SNAP_USER_COMMON/.config/superproductivity may not exist yet on the
  // first launch of a fresh Snap install. Without this, writeFileSync
  // would fail silently and the guard would never write a marker.
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    const content: MarkerContent = {
      ts: Date.now(),
      electronVersion: process.versions.electron,
    };
    fs.writeFileSync(activeMarker, JSON.stringify(content));
  } catch (e) {
    warn('gpu-startup-guard: failed to write marker', e);
  }

  return {
    disableGpu: previousCrash,
    reason: previousCrash ? 'crash-recovery' : null,
    markerPath: activeMarker,
  };
};

/**
 * Clears the crash marker. Must be preceded by `evaluateGpuStartupGuard`
 * in the same process — relies on the module-level `markerPath` that
 * `evaluateGpuStartupGuard` sets. No-op otherwise.
 *
 * Intended to be called from the `IPC.APP_READY` handler (after Angular
 * boot), not from `ready-to-show`: a blank/broken renderer can still
 * paint a first frame, and clearing the marker on that signal would
 * defeat the crash-recovery path.
 */
export const markGpuStartupSuccess = (): void => {
  if (!markerPath) return;
  try {
    fs.unlinkSync(markerPath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Non-ENOENT failure means the marker is still there. Next launch
      // will unnecessarily disable GPU — log so the cause is diagnosable.
      warn('gpu-startup-guard: failed to clear marker', e);
    }
  }
};
