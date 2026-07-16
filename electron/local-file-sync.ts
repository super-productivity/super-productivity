import { IPC } from './shared-with-frontend/ipc-events.const';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';
import { randomBytes } from 'crypto';
import {
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import * as path from 'path';
import { error, log } from 'electron-log/main';
import { app, dialog, ipcMain } from 'electron';
import { getWin } from './main-window';
import { resolveSyncPath, type ResolvedSyncPath } from './sync-path-resolver';
import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';
import { assertPathOutside } from './file-path-guard';
import { getImageDataUrl, importImage } from './image-cache';

// SECURITY: file-sync must never read/write/list inside the app's private dir,
// which holds settings/grants/db — touching it is a privilege-escalation
// primitive (e.g. forging the nodeExecution grant file). The path is
// renderer-supplied (untrusted plugin/XSS). Lazy getter — userData can be
// changed at startup (--user-data-dir, Snap). See file-path-guard.ts.
const getAppPrivateDir = (): string => app.getPath('userData');

// Main-owned sync folder path. Backed by simple-store under
// SimpleStoreKey.SYNC_FOLDER_PATH; cached in-memory after first load so each FS
// IPC doesn't re-read the file. The canonical form is stored so subsequent
// realpath comparisons in resolveSyncPath line up regardless of symlink/case-
// fold drift.
let _cachedSyncFolder: string | null | undefined = undefined;
let _loadPromise: Promise<string | null> | null = null;

// Folder picked but not yet committed via settings Save (#9075). Memory-only
// on purpose: a crash or close-without-save must leave the live sync target
// untouched. Main-owned so the renderer never round-trips an absolute path
// (#8228) — commit/discard reference this slot, they don't carry a path.
let _pendingSyncFolder: string | null = null;

// Bumped by every discard (IPC or renderer-death reset below). A pick
// snapshots it before opening the native dialog and refuses to arm the slot
// if it moved meanwhile: a discard during an open picker means the owning
// settings UI is gone (closeAllDialogs(), reload, non-modal WM quirks), and
// arming anyway would orphan a candidate that a later unrelated Save would
// silently commit.
let _discardGeneration = 0;

const _discardPendingSyncFolder = (): void => {
  _pendingSyncFolder = null;
  _discardGeneration++;
};

// A renderer reload/crash destroys the settings dialog without running its
// discard hook, which would leave a picked-but-never-saved folder armed to
// commit on an unrelated Save much later. Drop the candidate whenever the
// renderer navigates away or dies (in-app Angular routing is same-document
// and does not fire did-navigate). Installed lazily on first pick — the main
// window is guaranteed to exist there.
let _isPendingResetHookInstalled = false;
const _installPendingResetHook = (win: ReturnType<typeof getWin>): void => {
  if (_isPendingResetHookInstalled || !win?.webContents?.on) {
    return;
  }
  win.webContents.on('did-navigate', _discardPendingSyncFolder);
  win.webContents.on('render-process-gone', _discardPendingSyncFolder);
  _isPendingResetHookInstalled = true;
};

const _loadSyncFolderFromDisk = async (): Promise<string | null> => {
  const all = await loadSimpleStoreAll();
  const raw = all[SimpleStoreKey.SYNC_FOLDER_PATH];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

const getSyncFolderPath = async (): Promise<string | null> => {
  if (_cachedSyncFolder !== undefined) return _cachedSyncFolder;
  if (!_loadPromise) {
    _loadPromise = _loadSyncFolderFromDisk().then((v) => {
      // A pick (setSyncFolderPath) can complete while this first disk read is
      // still in flight. Only seed the cache if it's still unset, so the now-
      // stale disk value can't clobber the freshly-picked folder. The guard +
      // assignment run in one synchronous tick, so setSyncFolderPath cannot
      // interleave between them.
      if (_cachedSyncFolder === undefined) {
        _cachedSyncFolder = v;
      }
      return _cachedSyncFolder;
    });
  }
  return _loadPromise;
};

const setSyncFolderPath = async (rawPath: string): Promise<string> => {
  // Canonicalize at write time so the persisted value is the form
  // resolveSyncPath will compare against, and so a relative or
  // symlinked path is rejected before it gets stored.
  const canonical = realpathSync.native(rawPath);
  // Reject a folder equal to or inside userData BEFORE persisting. Otherwise
  // we'd store a "configured" folder that resolveSyncPath then denies on every
  // sync op — safe but confusing. Throwing here funnels into the handler's
  // createSafeIpcError path; the store and the in-memory cache stay untouched.
  assertPathOutside(getAppPrivateDir(), canonical);
  await saveSimpleStore(SimpleStoreKey.SYNC_FOLDER_PATH, canonical);
  _cachedSyncFolder = canonical;
  return canonical;
};

// Same `(maybeRoot, relative, userData) → absolutePath` resolution wrapped
// so the five handlers below don't repeat the same incantation. Returns the
// absolute path on success; throws PathNotAllowedError on rejection (the
// existing handler try/catch funnels both into a safe IPC error).
const _resolveRelative = async (
  relativePath: string | undefined,
): Promise<ResolvedSyncPath> =>
  resolveSyncPath(
    (await getSyncFolderPath()) ?? undefined,
    relativePath ?? '',
    getAppPrivateDir(),
  );

const _pathNotAllowed = (): Error => {
  const e = new Error('Path not allowed for the sync folder');
  e.name = 'PathNotAllowedError';
  delete e.stack;
  return e;
};

const _isEnoent = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  'code' in e &&
  (e as { code?: unknown }).code === 'ENOENT';

const _assertSaveTargetIsFilePath = (resolved: ResolvedSyncPath): void => {
  if (resolved.isRoot) {
    throw _pathNotAllowed();
  }
  try {
    if (statSync(resolved.absolutePath).isDirectory()) {
      throw _pathNotAllowed();
    }
  } catch (e) {
    if (!_isEnoent(e)) {
      throw e;
    }
  }
};

const _resolveTempPathForSave = (resolved: ResolvedSyncPath): string => {
  const tempName = [
    `.${path.basename(resolved.absolutePath)}`,
    process.pid,
    Date.now(),
    randomBytes(8).toString('hex'),
    'tmp',
  ].join('.');
  const candidate = path.join(path.dirname(resolved.absolutePath), tempName);
  const tempRelative = path.relative(resolved.root, candidate);
  return resolveSyncPath(resolved.root, tempRelative, getAppPrivateDir()).absolutePath;
};

export const initLocalFileSyncAdapter = (): void => {
  ipcMain.handle(
    IPC.FILE_SYNC_SAVE,
    async (
      ev,
      {
        relativePath,
        dataStr,
        localRev,
      }: {
        relativePath: string;
        dataStr: string;
        localRev: string | null;
      },
    ): Promise<string | Error> => {
      let tempPath: string | null = null;
      try {
        const resolved = await _resolveRelative(relativePath);
        _assertSaveTargetIsFilePath(resolved);
        const filePath = resolved.absolutePath;
        log(IPC.FILE_SYNC_SAVE, {
          dataLength: dataStr.length,
          hasData: dataStr.length > 0,
        });

        // Atomic write: write to temp file first, then rename.
        // renameSync is atomic on ext4/APFS/NTFS, so a crash mid-write
        // won't corrupt the original file.
        tempPath = _resolveTempPathForSave(resolved);
        writeFileSync(tempPath, dataStr, { encoding: 'utf8', flag: 'wx' });
        renameSync(tempPath, filePath);
        tempPath = null;

        return getRev(filePath);
      } catch (e) {
        if (tempPath) {
          try {
            unlinkSync(tempPath);
          } catch {
            // Best-effort cleanup; the safe IPC error below is the important part.
          }
        }
        error('Local file sync save failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_SAVE, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_LOAD,
    async (
      ev,
      {
        relativePath,
        localRev,
      }: {
        relativePath: string;
        localRev: string | null;
      },
    ): Promise<{ rev: string; dataStr: string | undefined } | Error> => {
      try {
        const filePath = (await _resolveRelative(relativePath)).absolutePath;
        log(IPC.FILE_SYNC_LOAD, {
          hasLocalRev: !!localRev,
        });
        const dataStr = readFileSync(filePath, { encoding: 'utf-8' });
        log('Local file sync load completed', {
          dataLength: dataStr.length,
        });
        return {
          rev: getRev(filePath),
          dataStr,
        };
      } catch (e) {
        error('Local file sync load failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_LOAD, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_REMOVE,
    async (
      ev,
      {
        relativePath,
      }: {
        relativePath: string;
      },
    ): Promise<void | Error> => {
      try {
        const filePath = (await _resolveRelative(relativePath)).absolutePath;
        log(IPC.FILE_SYNC_REMOVE);
        unlinkSync(filePath);
        return;
      } catch (e) {
        error('Local file sync remove failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_REMOVE, e);
      }
    },
  );

  ipcMain.handle(
    IPC.CHECK_DIR_EXISTS,
    async (
      ev,
      {
        relativePath,
      }: {
        relativePath?: string;
      },
    ): Promise<true | Error> => {
      try {
        // Default to the sync root itself (relativePath = '') so the legacy
        // "is the configured sync folder reachable?" check still works.
        const dirPath = (await _resolveRelative(relativePath)).absolutePath;
        const dirEntries = readdirSync(dirPath);
        log(IPC.CHECK_DIR_EXISTS, {
          dirEntryCount: dirEntries.length,
        });
        return true;
      } catch (e) {
        error('Local file sync directory check failed', getSafeErrorMeta(e));
        if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          log(
            'ERR: Permission denied. If running as a snap, ensure the "home" or "removable-media" interface is connected.',
          );
        }
        return createSafeIpcError(IPC.CHECK_DIR_EXISTS, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_LIST_FILES,
    async (
      ev,
      {
        relativePath,
      }: {
        relativePath?: string;
      },
    ): Promise<string[] | Error> => {
      try {
        const dirPath = (await _resolveRelative(relativePath)).absolutePath;
        return readdirSync(dirPath);
      } catch (e) {
        error('Local file sync list files failed', getSafeErrorMeta(e));
        if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          log(
            'ERR: Permission denied. If running as a snap, ensure the "home" or "removable-media" interface is connected.',
          );
        }
        return createSafeIpcError(IPC.FILE_SYNC_LIST_FILES, e);
      }
    },
  );

  ipcMain.handle(IPC.PICK_DIRECTORY, async (): Promise<string | Error | undefined> => {
    try {
      const win = getWin();
      _installPendingResetHook(win);
      const discardGenAtOpen = _discardGeneration;
      const { canceled, filePaths } = (await dialog.showOpenDialog(win, {
        title: 'Select sync folder',
        buttonLabel: 'Select Folder',
        properties: [
          'openDirectory',
          'createDirectory',
          'promptToCreate',
          'dontAddToRecent',
        ],
      })) as unknown as { canceled: boolean; filePaths: string[] };
      if (canceled || !filePaths[0]) {
        return undefined;
      }
      if (_discardGeneration !== discardGenAtOpen) {
        // The settings UI that owned this pick was torn down (its discard
        // already ran) while the native dialog was open — nobody is left to
        // commit or discard the result. Treat as cancel instead of arming an
        // ownerless candidate.
        return undefined;
      }
      // Prepare-only (#9075): validate NOW so a bad pick errors at pick time,
      // but do NOT persist or swap the live root — a sync firing between pick
      // and settings Save must still hit the old folder, and Cancel must be
      // able to abandon the pick. COMMIT_PICKED_DIRECTORY makes it live.
      // Surfacing validation failures as a safe error (not undefined) keeps
      // them distinguishable from user-cancel.
      const canonical = realpathSync.native(filePaths[0]);
      assertPathOutside(getAppPrivateDir(), canonical);
      _pendingSyncFolder = canonical;
      return canonical;
    } catch (e) {
      error('PICK_DIRECTORY failed to validate picked folder', getSafeErrorMeta(e));
      return createSafeIpcError(IPC.PICK_DIRECTORY, e);
    }
  });

  ipcMain.handle(
    IPC.COMMIT_PICKED_DIRECTORY,
    async (): Promise<{ path: string; isChanged: boolean } | null | Error> => {
      try {
        // Capture the slot before any await: a DISCARD or PICK landing while
        // `prev` loads must not turn this commit into a null-deref or swap
        // the path under it mid-flight.
        const pending = _pendingSyncFolder;
        if (pending === null) {
          // Nothing picked this session (or already committed/discarded) —
          // a routine settings Save without a pick. Not an error.
          return null;
        }
        const prev = await getSyncFolderPath();
        // Re-canonicalize + re-validate at commit time: the folder can be
        // deleted or symlink-swapped between pick and Save. On failure the
        // pending slot is kept so a retry stays loud (errors again) instead
        // of silently saving without the folder change; the user re-picks
        // or cancels.
        const committed = await setSyncFolderPath(pending);
        // Only clear the slot if it still holds what we committed — a newer
        // pick that raced in must survive for its own commit.
        if (_pendingSyncFolder === pending) {
          _pendingSyncFolder = null;
        }
        // isChanged lets the renderer fire its target-change invalidation
        // only on a real move — re-picking the same folder must not wipe
        // per-target sync state (see notifyProviderTargetChanged docs).
        return { path: committed, isChanged: committed !== prev };
      } catch (e) {
        error('COMMIT_PICKED_DIRECTORY failed to persist', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.COMMIT_PICKED_DIRECTORY, e);
      }
    },
  );

  ipcMain.handle(IPC.DISCARD_PICKED_DIRECTORY, async (): Promise<void> => {
    _discardPendingSyncFolder();
  });

  ipcMain.handle(IPC.GET_SYNC_FOLDER_PATH, async (): Promise<string | null> => {
    return getSyncFolderPath();
  });

  ipcMain.handle(
    IPC.IMAGE_PICK_AND_IMPORT,
    async (): Promise<{ id: string; mimeType: string } | null | Error> => {
      // SECURITY: the dialog + import are atomic and run together in main.
      // The renderer never holds the absolute path — it cannot trigger an
      // image read without a user clicking through the native picker.
      // (The previous shape exposed an `importImage(path)` IPC that the
      // renderer could call with any image-extension path it pleased; this
      // version closes that gap.)
      try {
        const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
          title: 'Select image',
          buttonLabel: 'Select',
          properties: ['openFile'],
          filters: [
            {
              name: 'Images',
              // Keep in sync with MIME_BY_EXT in image-cache.ts (svg excluded
              // on purpose — scriptable format).
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'],
            },
          ],
        })) as unknown as { canceled: boolean; filePaths: string[] };
        if (canceled || !filePaths[0]) {
          // User cancelled — distinct from validation failure so the renderer
          // can stay silent instead of showing a "couldn't read image" snack.
          return null;
        }
        const imported = await importImage(filePaths[0]);
        if (!imported) {
          // Reject as an error: validation failed (extension, size, etc.) so
          // the renderer surfaces the error path, not the cancel path. The
          // safe-error wrapper below strips the stack and renames the error
          // so it matches the FS handlers' contract — main bundle paths
          // (from a raw `e.stack`) are not leaked.
          throw new Error('Selected image could not be imported');
        }
        return imported;
      } catch (e) {
        error('Image pick-and-import failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.IMAGE_PICK_AND_IMPORT, e);
      }
    },
  );

  ipcMain.handle(
    IPC.IMAGE_CACHE_GET_DATA_URL,
    async (_, id: string): Promise<string | null> => {
      return getImageDataUrl(id);
    },
  );

  ipcMain.handle(
    IPC.SHOW_OPEN_DIALOG,
    async (
      _,
      options: {
        properties: string[];
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      },
    ): Promise<string[] | undefined> => {
      const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
        title: options.title || 'Select folder',
        buttonLabel: 'Select',
        properties: options.properties as any,
        defaultPath: options.defaultPath,
        filters: options.filters,
      })) as unknown as { canceled: boolean; filePaths: string[] };
      if (canceled) {
        return undefined;
      } else {
        return filePaths;
      }
    },
  );
};

const getRev = (filePath: string): string => {
  const fileStat = statSync(filePath);
  return fileStat.mtime.getTime().toString();
};

const getSafeErrorMeta = (
  e: unknown,
): {
  errorName: string;
  errorCode?: string | number;
} => {
  const errorName =
    e instanceof Error
      ? e.name
      : typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string'
        ? e.name
        : 'UnknownError';
  const errorCode =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (typeof e.code === 'string' || typeof e.code === 'number')
      ? e.code
      : undefined;

  return errorCode === undefined ? { errorName } : { errorName, errorCode };
};

const createSafeIpcError = (operation: IPC, e: unknown): Error => {
  const { errorName, errorCode } = getSafeErrorMeta(e);
  const codeMessagePart = errorCode === undefined ? '' : ` (code: ${errorCode})`;
  const safeError = new Error(`${operation} failed: ${errorName}${codeMessagePart}`, {
    cause: { name: errorName, code: errorCode },
  }) as Error & { code?: string | number };
  safeError.name = errorName;
  if (errorCode !== undefined) {
    safeError.code = errorCode;
  }
  delete safeError.stack;

  return safeError;
};
