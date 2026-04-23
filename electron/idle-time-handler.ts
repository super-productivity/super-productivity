import { ChildProcessWithoutNullStreams, exec, execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { app, powerMonitor } from 'electron';
import electronLog from 'electron-log/main';
import { CONFIG } from './CONFIG';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const log = electronLog.scope('IdleTimeHandler');
const WAYLAND_IDLE_HELPER_READY_TIMEOUT_MS = 3000;
const WAYLAND_IDLE_HELPER_PROBE_TIMEOUT_MS = 3000;

type IdleDetectionMethod =
  | 'powerMonitor'
  | 'gnomeDBus'
  | 'waylandIdleNotify'
  | 'xprintidle'
  | 'loginctl'
  | 'none';

interface EnvironmentInfo {
  readonly isWayland: boolean;
  readonly isGnomeWayland: boolean;
  readonly isSnap: boolean;
  readonly sessionType?: string;
  readonly currentDesktop?: string;
  readonly waylandDisplay?: string;
  readonly gnomeShellSession?: string;
}

interface IdleMethodCandidate {
  readonly name: IdleDetectionMethod;
  readonly test: () => Promise<boolean>;
}

export class IdleTimeHandler {
  private readonly _environment: EnvironmentInfo;
  private _methodDetectionPromise: Promise<IdleDetectionMethod> | null = null;
  private _workingMethod: IdleDetectionMethod = 'none';
  private _waylandIdleHelperProcess: ChildProcessWithoutNullStreams | null = null;
  private _waylandIdleHelperReady: boolean = false;
  private _waylandIdleHelperReadyPromise: Promise<boolean> | null = null;
  private _waylandIdleHelperBuffer: string = '';
  private _waylandIdleSinceMs: number | null = null;

  constructor() {
    this._environment = this._detectEnvironment();
    this._methodDetectionPromise = this._initializeWorkingMethod();
  }

  private _detectEnvironment(): EnvironmentInfo {
    const sessionType = process.env.XDG_SESSION_TYPE;
    const currentDesktop = process.env.XDG_CURRENT_DESKTOP;
    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    const gnomeShellSession = process.env.GNOME_SHELL_SESSION_MODE;

    const isWayland = sessionType === 'wayland' || !!waylandDisplay;
    const normalizedDesktop = currentDesktop?.toLowerCase() ?? '';
    const isGnomeDesktop =
      normalizedDesktop.includes('gnome') ||
      normalizedDesktop.includes('ubuntu') ||
      !!gnomeShellSession;
    const isGnomeWayland = isWayland && isGnomeDesktop;
    const isSnap = !!process.env.SNAP || !!process.env.SNAP_NAME;

    const environment: EnvironmentInfo = {
      isWayland,
      isGnomeWayland,
      isSnap,
      sessionType,
      currentDesktop,
      waylandDisplay,
      gnomeShellSession,
    };

    log.debug('Environment detection:', environment);
    return environment;
  }

  get currentMethod(): IdleDetectionMethod {
    return this._workingMethod;
  }

  dispose(): void {
    if (this._waylandIdleHelperProcess) {
      this._waylandIdleHelperProcess.kill();
    }
    this._resetWaylandIdleHelperState();
  }

  async getIdleTime(): Promise<number> {
    const methodUsed = await this._ensureWorkingMethod();

    switch (methodUsed) {
      case 'powerMonitor':
        try {
          return powerMonitor.getSystemIdleTime() * 1000;
        } catch (error) {
          this._logError('powerMonitor failed', error);
          return 0;
        }

      case 'gnomeDBus':
        try {
          const result = await this._getGnomeIdleTime();
          return result ?? 0;
        } catch (error) {
          this._logError('GNOME DBus error', error);
          return 0;
        }

      case 'waylandIdleNotify':
        try {
          const isReady = await this._ensureWaylandIdleHelperStarted();
          if (!isReady || this._waylandIdleSinceMs === null) {
            return 0;
          }
          return Math.max(0, Date.now() - this._waylandIdleSinceMs);
        } catch (error) {
          this._logError('Wayland idle-notify helper error', error);
          return 0;
        }

      case 'xprintidle':
        try {
          const result = await this._getXprintidleTime();
          return result ?? 0;
        } catch (error) {
          this._logError('xprintidle error', error);
          return 0;
        }

      case 'loginctl':
        try {
          const result = await this._getLoginctlIdleTime();
          return result ?? 0;
        } catch (error) {
          this._logError('loginctl error', error);
          return 0;
        }

      case 'none':
      default:
        this._logError('No working idle detection method available', undefined);
        return 0;
    }
  }

  private async _initializeWorkingMethod(): Promise<IdleDetectionMethod> {
    try {
      const method = await this._determineWorkingMethod();
      this._workingMethod = method;
      log.info(`Idle detection method ready: ${method}`);
      return method;
    } catch (error) {
      log.warn('Idle detection initialization failed', error);
      this._workingMethod = 'none';
      return 'none';
    }
  }

  private async _ensureWorkingMethod(): Promise<IdleDetectionMethod> {
    if (!this._methodDetectionPromise) {
      this._methodDetectionPromise = this._initializeWorkingMethod();
    }
    return this._methodDetectionPromise;
  }

  private async _determineWorkingMethod(): Promise<IdleDetectionMethod> {
    log.debug('Determining idle detection method...');

    if (!this._environment.isWayland) {
      log.debug('Using powerMonitor for non-Wayland session');
      return 'powerMonitor';
    }

    for (const candidate of this._buildWaylandCandidates()) {
      log.debug(`Testing ${candidate.name}...`);
      try {
        const works = await candidate.test();
        if (works) {
          log.info(`Selected ${candidate.name} for idle detection`);
          return candidate.name;
        }
        log.debug(`${candidate.name} test failed`);
      } catch (error) {
        log.warn(`${candidate.name} test error`, error);
      }
    }

    log.warn(
      'No working idle detection method found for Wayland. Idle detection will be disabled.',
    );
    return 'none';
  }

  private _buildWaylandCandidates(): IdleMethodCandidate[] {
    const candidates: IdleMethodCandidate[] = [];

    if (this._environment.isGnomeWayland) {
      candidates.push({
        name: 'gnomeDBus',
        test: async () => {
          try {
            const idleTime = await this._getGnomeIdleTime();
            return idleTime !== null;
          } catch (error) {
            if (this._environment.isSnap) {
              log.debug('GNOME DBus test failed in snap environment', error);
            }
            return false;
          }
        },
      });
    }

    candidates.push({
      name: 'waylandIdleNotify',
      test: async () => this._probeWaylandIdleHelper(),
    });

    candidates.push({
      name: 'xprintidle',
      test: async () => {
        try {
          const idleTime = await this._getXprintidleTime();
          return idleTime !== null;
        } catch {
          return false;
        }
      },
    });

    if (this._environment.isSnap) {
      log.debug('Skipping loginctl in snap environment');
    } else {
      candidates.push({
        name: 'loginctl',
        test: async () => {
          try {
            const idleTime = await this._getLoginctlIdleTime();
            return idleTime !== null;
          } catch {
            return false;
          }
        },
      });
    }

    return candidates;
  }

  private async _getGnomeIdleTime(): Promise<number | null> {
    const isSnap = this._environment.isSnap;
    if (isSnap) {
      log.debug('Attempting GNOME idle detection inside snap environment');
    }

    let command =
      'gdbus call --session --dest org.gnome.Mutter.IdleMonitor --object-path /org/gnome/Mutter/IdleMonitor/Core --method org.gnome.Mutter.IdleMonitor.GetIdletime';

    try {
      await execAsync('which gdbus', { timeout: 1000 });
    } catch {
      if (isSnap) {
        log.warn(
          'gdbus unavailable in snap environment, skipping dbus-send fallback to avoid libdbus mismatch',
        );
        return null;
      }
      command =
        'dbus-send --print-reply --dest=org.gnome.Mutter.IdleMonitor /org/gnome/Mutter/IdleMonitor/Core org.gnome.Mutter.IdleMonitor.GetIdletime';
    }

    let stdout: string;
    try {
      const result = await execAsync(command, { timeout: 5000 });
      stdout = result.stdout;
    } catch (error) {
      if (isSnap) {
        log.warn('gdbus idle monitor failed in snap environment', error);
        return null;
      }
      throw error;
    }

    const match = stdout.match(/uint64\s+(\d+)|(?:\(uint64\s+)?(\d+)(?:,\))?/);
    if (match) {
      const idleMs = parseInt(match[1] || match[2], 10);
      if (idleMs >= 0 && idleMs < Number.MAX_SAFE_INTEGER) {
        return idleMs;
      }
    }

    return null;
  }

  private async _ensureWaylandIdleHelperStarted(): Promise<boolean> {
    if (this._waylandIdleHelperReady && this._waylandIdleHelperProcess) {
      return true;
    }

    if (this._waylandIdleHelperReadyPromise) {
      return this._waylandIdleHelperReadyPromise;
    }

    const helperPath = this._resolveWaylandIdleHelperPath();
    if (!helperPath) {
      return false;
    }

    this._waylandIdleHelperReadyPromise = new Promise<boolean>((resolve) => {
      let isSettled = false;
      const settle = (value: boolean): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        resolve(value);
      };

      const child = spawn(helperPath, ['--timeout-ms', String(CONFIG.MIN_IDLE_TIME)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this._waylandIdleHelperProcess = child;
      this._waylandIdleHelperReady = false;
      this._waylandIdleHelperBuffer = '';
      this._waylandIdleSinceMs = null;

      const readyTimeout = setTimeout(() => {
        log.warn('Wayland idle helper did not become ready in time');
        child.kill();
        settle(false);
      }, WAYLAND_IDLE_HELPER_READY_TIMEOUT_MS);

      child.stdout.on('data', (data: Buffer) => {
        this._waylandIdleHelperBuffer += data.toString();
        const lines = this._waylandIdleHelperBuffer.split('\n');
        this._waylandIdleHelperBuffer = lines.pop() ?? '';

        for (const line of lines.map((part) => part.trim()).filter(Boolean)) {
          if (line === 'ready') {
            clearTimeout(readyTimeout);
            this._waylandIdleHelperReady = true;
            settle(true);
            continue;
          }

          if (line === 'idle') {
            this._waylandIdleSinceMs = Date.now() - CONFIG.MIN_IDLE_TIME;
            continue;
          }

          if (line === 'resumed') {
            this._waylandIdleSinceMs = null;
            continue;
          }

          log.debug(`Wayland idle helper sent unexpected message: ${line}`);
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        log.warn(`Wayland idle helper stderr: ${data.toString().trim()}`);
      });

      child.on('error', (error) => {
        clearTimeout(readyTimeout);
        log.warn('Failed to start Wayland idle helper', error);
        this._resetWaylandIdleHelperState();
        settle(false);
      });

      child.on('exit', (code, signal) => {
        clearTimeout(readyTimeout);
        if (this._waylandIdleHelperReady) {
          log.warn(
            `Wayland idle helper exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          );
        }
        this._resetWaylandIdleHelperState();
        settle(false);
      });
    }).finally(() => {
      this._waylandIdleHelperReadyPromise = null;
    });

    return this._waylandIdleHelperReadyPromise;
  }

  private async _probeWaylandIdleHelper(): Promise<boolean> {
    const helperPath = this._resolveWaylandIdleHelperPath();
    if (!helperPath) {
      return false;
    }

    try {
      await execFileAsync(helperPath, ['--probe'], {
        timeout: WAYLAND_IDLE_HELPER_PROBE_TIMEOUT_MS,
      });
      return true;
    } catch (error) {
      log.debug('Wayland idle helper probe failed', error);
      return false;
    }
  }

  private _resetWaylandIdleHelperState(): void {
    this._waylandIdleHelperProcess = null;
    this._waylandIdleHelperReady = false;
    this._waylandIdleHelperBuffer = '';
    this._waylandIdleSinceMs = null;
  }

  private _resolveWaylandIdleHelperPath(): string | null {
    const helperPath = app.isPackaged
      ? path.join(path.dirname(process.execPath), 'wayland-idle-helper')
      : path.join(__dirname, 'bin', 'wayland-idle-helper');

    if (!existsSync(helperPath)) {
      log.debug(`Wayland idle helper binary not found at ${helperPath}`);
      return null;
    }

    return helperPath;
  }

  private async _getLoginctlIdleTime(): Promise<number | null> {
    const { stdout } = await execAsync('loginctl show-session -p IdleSinceHint', {
      timeout: 3000,
    });

    const match = stdout.match(/IdleSinceHint=(\d+)/);
    if (match && match[1]) {
      const idleSince = parseInt(match[1], 10);
      if (idleSince === 0) {
        return 0;
      }
      if (idleSince > 0) {
        const nowMs = Date.now() * 1000;
        const idleMs = nowMs - idleSince;
        if (idleMs >= 0 && idleMs < Number.MAX_SAFE_INTEGER) {
          return Math.floor(idleMs / 1000);
        }
      }
    }

    return null;
  }

  private async _getXprintidleTime(): Promise<number | null> {
    const { stdout } = await execAsync('xprintidle', { timeout: 3000 });
    const idleMs = parseInt(stdout.trim(), 10);
    if (!isNaN(idleMs) && idleMs >= 0) {
      return idleMs;
    }

    return null;
  }

  private _logError(context: string, error: unknown): void {
    log.debug(`${context} (falling back to 0):`, error);
  }
}
