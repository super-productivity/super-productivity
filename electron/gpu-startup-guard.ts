import * as fs from 'fs';
import { join } from 'path';
import { log } from 'electron-log/main';

// Persisted between launches so we can tell whether the previous process
// ever reached `ready-to-show`. Only read/written on Linux, where GPU init
// failures on confined packages (Snap + Mesa ABI drift, etc.) can leave the
// main process alive while the renderer never displays.
const MARKER_FILENAME = '.gpu-startup-state';
const MARKER_LAUNCHING = 'launching';
const MARKER_OK = 'ok';

const isTruthyEnv = (v: string | undefined): boolean =>
  v === '1' || v === 'true' || v === 'TRUE';

let markerPath: string | null = null;

export interface GpuGuardDecision {
  disableGpu: boolean;
  reason: 'env' | 'crash-recovery' | null;
}

/**
 * Evaluate whether to pass `--disable-gpu` on this launch and write a
 * `launching` marker so a future launch can detect a crash loop.
 *
 * Must run after `app.setPath('userData', ...)` (so the marker lands in the
 * right directory) but before `app.whenReady()` resolves (so the switch
 * still takes effect). Safe to call on all platforms; does nothing on
 * non-Linux hosts where the Snap/Mesa failure modes don't apply.
 */
export const evaluateGpuStartupGuard = (userDataPath: string): GpuGuardDecision => {
  const userDisable = isTruthyEnv(process.env.SP_DISABLE_GPU);
  const userEnable = isTruthyEnv(process.env.SP_ENABLE_GPU);

  if (process.platform !== 'linux') {
    return { disableGpu: userDisable && !userEnable, reason: userDisable ? 'env' : null };
  }

  markerPath = join(userDataPath, MARKER_FILENAME);

  let previousCrash = false;
  try {
    if (fs.existsSync(markerPath)) {
      const content = fs.readFileSync(markerPath, 'utf8').trim();
      previousCrash = content === MARKER_LAUNCHING;
    }
  } catch (e) {
    log('gpu-startup-guard: failed to read marker', e);
  }

  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(markerPath, MARKER_LAUNCHING);
  } catch (e) {
    log('gpu-startup-guard: failed to write marker', e);
  }

  if (userEnable) {
    return { disableGpu: false, reason: null };
  }
  if (userDisable) {
    return { disableGpu: true, reason: 'env' };
  }
  if (previousCrash) {
    return { disableGpu: true, reason: 'crash-recovery' };
  }
  return { disableGpu: false, reason: null };
};

/**
 * Called once the main window has rendered at least one frame
 * (`ready-to-show`). Clears the crash marker so the next launch is treated
 * as a clean start.
 */
export const markStartupSuccess = (): void => {
  if (!markerPath) return;
  try {
    fs.writeFileSync(markerPath, MARKER_OK);
  } catch (e) {
    log('gpu-startup-guard: failed to mark startup success', e);
  }
};
