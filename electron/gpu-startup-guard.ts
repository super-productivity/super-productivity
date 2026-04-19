import * as fs from 'fs';
import { join } from 'path';
import { log } from 'electron-log/main';

// Persisted between launches so we can tell whether the previous process
// ever reached a fully booted state. Only read/written on Linux, where GPU
// init failures on confined packages (Snap + Mesa ABI drift, etc.) can
// leave the main process alive while the renderer never renders.
//
// Marker is JSON so we can track a failure counter (avoid disabling GPU on
// a single unrelated crash / force-quit) and the Electron version the
// counter was recorded against (Electron upgrades commonly trip a
// first-launch GPU failure that the GPU-cache purge in start-app.ts fixes;
// we shouldn't latch off GPU on that signal alone).
const MARKER_FILENAME = '.gpu-startup-state.json';
// Disable GPU after this many consecutive launches failed to boot through
// IPC.APP_READY. `2` means a single bad launch is tolerated; two in a row
// trips the fallback.
const FAILURE_THRESHOLD = 2;

interface MarkerState {
  // Incremented at each startup, reset to 0 on successful boot.
  failedLaunches: number;
  // Once the threshold is hit, the fallback is sticky across launches so
  // users on a persistently broken GPU stack aren't forced through a
  // failed launch every few restarts. Cleared by SP_ENABLE_GPU=1 or an
  // Electron version change.
  sticky: boolean;
  // Used to reset state on Electron upgrade (see above).
  electronVersion: string;
}

const isTruthyEnv = (v: string | undefined): boolean =>
  !!v && /^(1|true|yes|on)$/i.test(v);

let markerPath: string | null = null;

export interface GpuGuardDecision {
  disableGpu: boolean;
  reason: 'env' | 'crash-recovery' | 'crash-recovery-sticky' | null;
  // Absolute path to the marker file, surfaced so the log message can tell
  // a stuck user exactly which file to delete to recover.
  markerPath: string | null;
}

const readMarker = (path: string, currentElectronVersion: string): MarkerState => {
  const fresh: MarkerState = {
    failedLaunches: 0,
    sticky: false,
    electronVersion: currentElectronVersion,
  };
  try {
    if (!fs.existsSync(path)) return fresh;
    const raw = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MarkerState>;
    // An Electron upgrade invalidates the counter: the GPU-cache purge in
    // start-app.ts is the first-line fix for upgrade-induced GPU failures,
    // and we want to give it a chance before latching off.
    if (parsed.electronVersion !== currentElectronVersion) return fresh;
    return {
      failedLaunches:
        typeof parsed.failedLaunches === 'number' ? parsed.failedLaunches : 0,
      sticky: parsed.sticky === true,
      electronVersion: currentElectronVersion,
    };
  } catch {
    // Malformed JSON / old plain-text marker from a prior version: treat
    // as a clean slate rather than crashing on parse.
    return fresh;
  }
};

const writeMarker = (path: string, state: MarkerState): void => {
  try {
    fs.mkdirSync(join(path, '..'), { recursive: true });
    fs.writeFileSync(path, JSON.stringify(state));
  } catch (e) {
    log('gpu-startup-guard: failed to write marker', e);
  }
};

/**
 * Evaluate whether to disable GPU acceleration on this launch, and persist
 * a "launch in progress" marker so a future launch can detect a crash loop.
 *
 * Must run after `app.setPath('userData', ...)` (so the marker lands in the
 * right directory) but before `app.whenReady()` resolves, because the
 * caller applies the decision via `app.disableHardwareAcceleration()`
 * which is only honored pre-ready.
 *
 * The marker is only tracked on Linux — the GPU init failure modes this
 * guards against (Snap Mesa ABI drift, DRI node issues) are Linux-specific.
 * The env-var escape hatches apply on every platform.
 */
export const evaluateGpuStartupGuard = (
  userDataPath: string,
  currentElectronVersion: string,
): GpuGuardDecision => {
  const userDisable = isTruthyEnv(process.env.SP_DISABLE_GPU);
  const userEnable = isTruthyEnv(process.env.SP_ENABLE_GPU);
  // Unified precedence across platforms: explicit enable beats explicit
  // disable beats auto-detection. An enable override also clears any
  // sticky auto-disable state on disk.
  if (userEnable) {
    // Clear sticky state so a one-time override sticks if the user never
    // re-sets the env var but the underlying issue is resolved.
    if (process.platform === 'linux') {
      markerPath = join(userDataPath, MARKER_FILENAME);
      writeMarker(markerPath, {
        failedLaunches: 0,
        sticky: false,
        electronVersion: currentElectronVersion,
      });
    }
    return { disableGpu: false, reason: null, markerPath };
  }

  if (process.platform !== 'linux') {
    return {
      disableGpu: userDisable,
      reason: userDisable ? 'env' : null,
      markerPath: null,
    };
  }

  markerPath = join(userDataPath, MARKER_FILENAME);
  const state = readMarker(markerPath, currentElectronVersion);

  // SP_DISABLE_GPU wins over auto-detection but does not affect the
  // marker counters — the user may toggle it off later and we shouldn't
  // hide a real crash loop behind their manual override.
  if (userDisable) {
    writeMarker(markerPath, {
      ...state,
      failedLaunches: state.failedLaunches + 1,
      electronVersion: currentElectronVersion,
    });
    return { disableGpu: true, reason: 'env', markerPath };
  }

  // Sticky fallback: once we've latched off, stay off until the user
  // explicitly re-enables with SP_ENABLE_GPU=1 or the Electron version
  // changes. Increment the counter but don't reset sticky.
  if (state.sticky) {
    writeMarker(markerPath, {
      ...state,
      failedLaunches: state.failedLaunches + 1,
    });
    return { disableGpu: true, reason: 'crash-recovery-sticky', markerPath };
  }

  // Count this attempt. If the previous runs didn't reach IPC.APP_READY
  // often enough to pass the threshold, latch off.
  const nextCount = state.failedLaunches + 1;
  if (nextCount >= FAILURE_THRESHOLD) {
    writeMarker(markerPath, {
      failedLaunches: nextCount,
      sticky: true,
      electronVersion: currentElectronVersion,
    });
    return { disableGpu: true, reason: 'crash-recovery', markerPath };
  }

  writeMarker(markerPath, {
    failedLaunches: nextCount,
    sticky: false,
    electronVersion: currentElectronVersion,
  });
  return { disableGpu: false, reason: null, markerPath };
};

/**
 * Called once the app has fully booted (IPC.APP_READY from the renderer,
 * which fires after Angular startup). Resets the crash counter so the next
 * launch is treated as a clean start. Leaves `sticky` alone — once we've
 * latched off, only an explicit user action re-enables GPU.
 */
export const markStartupSuccess = (): void => {
  if (!markerPath) return;
  try {
    const raw = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : null;
    const prev = raw ? (JSON.parse(raw) as Partial<MarkerState>) : {};
    writeMarker(markerPath, {
      failedLaunches: 0,
      sticky: prev.sticky === true,
      electronVersion:
        typeof prev.electronVersion === 'string' ? prev.electronVersion : '',
    });
  } catch (e) {
    log('gpu-startup-guard: failed to mark startup success', e);
  }
};
