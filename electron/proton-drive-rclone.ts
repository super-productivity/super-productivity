import { IPC } from './shared-with-frontend/ipc-events.const';
import { ipcMain } from 'electron';
import { error, log } from 'electron-log/main';
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { createServer } from 'net';

/**
 * Proton Drive sync bridge for Electron.
 *
 * Proton Drive has no usable third-party API/SDK (auth + E2E crypto are not
 * exposed). The one tool that authenticates and handles Proton's encryption
 * today is rclone's reverse-engineered `protondrive` backend. So we run
 * `rclone serve webdav <remote>:` on a random loopback port with random
 * basic-auth credentials, and point Super Productivity's existing WebDAV
 * provider at it. No Proton credentials are ever stored by the app — the user
 * configures the remote once via `rclone config`; we only need the remote name.
 *
 * Desktop (Electron) only.
 */

export interface ProtonDriveServeInfo {
  baseUrl: string;
  userName: string;
  password: string;
}

interface EnsureServerArgs {
  remoteName: string;
  rcloneBinaryPath?: string;
}

interface RunningServer extends ProtonDriveServeInfo {
  child: ChildProcessWithoutNullStreams;
  remoteName: string;
  binaryPath: string;
}

const DEFAULT_REMOTE_NAME = 'protondrive';
const SERVE_READY_TIMEOUT_MS = 20_000;
const SERVE_READY_POLL_MS = 250;

let _server: RunningServer | null = null;

const _sanitizeRemoteName = (remoteName?: string): string => {
  const name = (remoteName || DEFAULT_REMOTE_NAME).trim().replace(/:+$/, '');
  // rclone remote names are restricted to word chars, spaces, dots and dashes.
  if (!/^[\w .-]+$/.test(name)) {
    throw new Error(`Invalid rclone remote name: "${name}"`);
  }
  return name;
};

const _resolveBinaryPath = (rcloneBinaryPath?: string): string => {
  const trimmed = rcloneBinaryPath?.trim();
  // Falling back to the bare name relies on the system PATH. GUI-launched apps
  // on macOS may have a reduced PATH, hence the option to set an explicit path.
  return trimmed || (process.platform === 'win32' ? 'rclone.exe' : 'rclone');
};

const _findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });

/**
 * Lists configured rclone remotes (e.g. `['protondrive:', 'gdrive:']`).
 * Doubles as a binary-availability probe — a spawn ENOENT means rclone is not
 * installed / not on PATH.
 */
const _listRemotes = (binaryPath: string): Promise<string[]> =>
  new Promise((resolve, reject) => {
    execFile(binaryPath, ['listremotes'], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              'rclone executable not found. Install rclone and ensure it is on your PATH, or set an explicit rclone path in the sync settings.',
            ),
          );
          return;
        }
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve(
        stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
      );
    });
  });

const _assertRemoteExists = async (
  binaryPath: string,
  remoteName: string,
): Promise<void> => {
  const remotes = await _listRemotes(binaryPath);
  if (!remotes.includes(`${remoteName}:`)) {
    throw new Error(
      `rclone remote "${remoteName}:" is not configured. Run \`rclone config\` and create a Proton Drive remote named "${remoteName}".`,
    );
  }
};

const _waitForServeReady = async (info: ProtonDriveServeInfo): Promise<void> => {
  const deadline = Date.now() + SERVE_READY_TIMEOUT_MS;
  const authHeader = `Basic ${Buffer.from(`${info.userName}:${info.password}`).toString('base64')}`;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(info.baseUrl, {
        method: 'PROPFIND',
        headers: { Authorization: authHeader, Depth: '0' },
      });
      // Any authenticated, non-5xx response means the server is up.
      if (res.status < 500) {
        return;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, SERVE_READY_POLL_MS));
  }
  throw new Error(
    `rclone WebDAV server did not become ready in time${lastErr ? `: ${String(lastErr)}` : ''}`,
  );
};

const _stopServer = (): void => {
  if (_server) {
    log('ProtonDrive: stopping rclone serve');
    try {
      _server.child.kill();
    } catch (e) {
      error(e);
    }
    _server = null;
  }
};

const _startServer = async (
  binaryPath: string,
  remoteName: string,
): Promise<RunningServer> => {
  const port = await _findFreePort();
  const userName = randomBytes(9).toString('base64url');
  const password = randomBytes(24).toString('base64url');
  const baseUrl = `http://127.0.0.1:${port}/`;

  log(`ProtonDrive: starting rclone serve webdav for "${remoteName}:" on ${baseUrl}`);
  const child = spawn(
    binaryPath,
    [
      'serve',
      'webdav',
      `${remoteName}:`,
      '--addr',
      `127.0.0.1:${port}`,
      '--user',
      userName,
      '--pass',
      password,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  ) as ChildProcessWithoutNullStreams;

  child.stderr.on('data', (d: Buffer) => {
    // rclone logs operational info to stderr; keep it for diagnostics but never
    // log the data itself (it can reference user file names).
    log('ProtonDrive rclone:', d.toString().slice(0, 500));
  });
  child.on('exit', (code) => {
    log(`ProtonDrive: rclone serve exited (code ${code})`);
    if (_server && _server.child === child) {
      _server = null;
    }
  });
  child.on('error', (e) => {
    error('ProtonDrive: rclone serve failed to start');
    error(e);
    if (_server && _server.child === child) {
      _server = null;
    }
  });

  const info: ProtonDriveServeInfo = { baseUrl, userName, password };
  try {
    await _waitForServeReady(info);
  } catch (e) {
    try {
      child.kill();
    } catch {
      // ignore
    }
    throw e;
  }

  return { ...info, child, remoteName, binaryPath };
};

const _ensureServer = async (args: EnsureServerArgs): Promise<ProtonDriveServeInfo> => {
  const remoteName = _sanitizeRemoteName(args.remoteName);
  const binaryPath = _resolveBinaryPath(args.rcloneBinaryPath);

  // Reuse a healthy server only when it matches the requested config.
  if (
    _server &&
    !_server.child.killed &&
    _server.remoteName === remoteName &&
    _server.binaryPath === binaryPath
  ) {
    return {
      baseUrl: _server.baseUrl,
      userName: _server.userName,
      password: _server.password,
    };
  }

  _stopServer();
  await _assertRemoteExists(binaryPath, remoteName);
  _server = await _startServer(binaryPath, remoteName);
  return {
    baseUrl: _server.baseUrl,
    userName: _server.userName,
    password: _server.password,
  };
};

/**
 * Registers the Proton Drive rclone IPC handlers. Call once on app `ready`,
 * alongside the other sync adapters.
 */
export const initProtonDriveRcloneAdapter = (): void => {
  ipcMain.handle(
    IPC.PROTON_DRIVE_ENSURE_SERVER,
    async (_, args: EnsureServerArgs): Promise<ProtonDriveServeInfo | Error> => {
      try {
        return await _ensureServer(args);
      } catch (e) {
        error('ProtonDrive: ensureServer failed');
        error(e);
        return e instanceof Error ? e : new Error(String(e));
      }
    },
  );

  ipcMain.handle(IPC.PROTON_DRIVE_STOP_SERVER, (): void => {
    _stopServer();
  });

  ipcMain.handle(
    IPC.PROTON_DRIVE_CHECK,
    async (_, args: EnsureServerArgs): Promise<true | Error> => {
      try {
        // Full round-trip: binary present, remote configured, server reachable.
        await _ensureServer(args);
        return true;
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    },
  );
};

/**
 * Stops any running rclone serve process. Call on app quit.
 */
export const cleanupProtonDriveRclone = (): void => {
  _stopServer();
};
