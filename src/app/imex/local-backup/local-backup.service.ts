import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { EMPTY, interval, merge, Observable } from 'rxjs';
import { LocalBackupConfig } from '../../features/config/global-config.model';
import { debounceTime, map, switchMap, tap } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { LocalBackupMeta } from './local-backup.model';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { IS_ELECTRON } from '../../app.constants';
import { androidInterface } from '../../features/android/android-interface';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { T } from '../../t.const';
import { TranslateService } from '@ngx-translate/core';
import { AppDataComplete } from '../../op-log/model/model-config';
import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import {
  countAllTasks,
  countAllTasksInBackupStr,
  selectBestBackupStr,
  summarizeBackupStr,
} from './backup-ring.util';
import { SnackService } from '../../core/snack/snack.service';
import { Log } from '../../core/log';
import { confirmDialog } from '../../util/native-dialogs';
import { CapacitorPlatformService } from '../../core/platform/capacitor-platform.service';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const DEFAULT_BACKUP_INTERVAL = 5 * 60 * 1000;
// A2 (#7925): debounce window for the on-data-change backup trigger. The
// existing 5-min interval still bounds the worst case; this catches the
// typical "user made changes then put phone down" pattern before the next
// tick, so a subsequent overnight WebView eviction doesn't lose the most
// recent edits. Long enough that a flurry of UI actions settles into one
// backup; short enough that a real change is captured before the user
// backgrounds the app.
const DATA_CHANGE_BACKUP_DEBOUNCE = 30 * 1000;
const ANDROID_DB_KEY = 'backup';
// Previous-generation slot for the two-generation ring (#7901): the current
// `backup` is promoted here before being overwritten, so one bad/corrupt write
// cycle can never erase the only good copy.
const ANDROID_DB_KEY_PREV = 'backup_prev';
const IOS_BACKUP_FILENAME = 'super-productivity-backup.json';
const IOS_BACKUP_PREV_FILENAME = 'super-productivity-backup.prev.json';

// A3 (#7925) near-empty write-time overwrite guard. The exact-empty guard in
// `_backup()` only catches a fully-degraded store; this catches the harder
// case where a post-eviction boot leaves the store near-empty and the user
// adds 1–2 tasks before the 5-min timer fires. Refuse to overwrite an
// existing backup that has at least SUBSTANTIAL_EXISTING_TASKS tasks with a
// snapshot that has fewer than NEAR_EMPTY_NEW_TASKS tasks. Counts include
// archived tasks (via `countAllTasks`) so a heavily-archived backup doesn't
// look near-empty.
//
// Fail-safe: skipping a write only delays capturing a legitimate fresh start
// (the existing backup stays intact, the user's new tasks remain in the live
// store until the next tick), never loses data. The guard self-clears once
// the store grows back above NEAR_EMPTY_NEW_TASKS, so a deliberate
// bulk-delete is captured as soon as the user adds enough new tasks.
const NEAR_EMPTY_NEW_TASKS = 3;
const SUBSTANTIAL_EXISTING_TASKS = 10;

// const DEFAULT_BACKUP_INTERVAL = 6 * 1000;

@Injectable({
  providedIn: 'root',
})
export class LocalBackupService {
  private _destroyRef = inject(DestroyRef);
  private _configService = inject(GlobalConfigService);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _backupService = inject(BackupService);
  private _snackService = inject(SnackService);
  private _translateService = inject(TranslateService);
  private _platformService = inject(CapacitorPlatformService);
  private _localActions$ = inject(LOCAL_ACTIONS);

  private _cfg$: Observable<LocalBackupConfig> = this._configService.cfg$.pipe(
    map((cfg) => cfg.localBackup),
  );
  private _triggerBackupSave$: Observable<unknown> = this._cfg$.pipe(
    switchMap((cfg) =>
      cfg.isEnabled
        ? merge(
            interval(DEFAULT_BACKUP_INTERVAL),
            // A2 (#7925): debounced data-change trigger. Any local action
            // settles into a backup DATA_CHANGE_BACKUP_DEBOUNCE after the last
            // one. LOCAL_ACTIONS already filters out remote/sync replays, so
            // we never back up intermediate hydration state. The empty-state
            // guard in _backup() prevents writing a degraded post-eviction
            // snapshot over a good backup. _backup() also early-returns on
            // platforms without a target (web/PWA), so this trigger is safe
            // to subscribe everywhere; it's a no-op off Electron/Android/iOS.
            this._localActions$.pipe(debounceTime(DATA_CHANGE_BACKUP_DEBOUNCE)),
          )
        : EMPTY,
    ),
    tap(() => this._backup()),
  );

  init(): void {
    this._triggerBackupSave$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe();
  }

  checkBackupAvailable(): Promise<boolean | LocalBackupMeta> {
    if (IS_ANDROID_WEB_VIEW) {
      // Available if either ring slot holds a backup (#7901).
      return androidInterface.loadFromDbWrapped(ANDROID_DB_KEY).then(async (primary) => {
        if (primary) {
          return true;
        }
        const prev = await androidInterface.loadFromDbWrapped(ANDROID_DB_KEY_PREV);
        return !!prev;
      });
    }
    if (this._platformService.isIOS()) {
      return this._checkBackupAvailableIOS();
    }
    if (IS_ELECTRON) {
      return window.ea.checkBackupAvailable();
    }
    return Promise.resolve(false);
  }

  loadBackupElectron(backupPath: string): Promise<string> {
    return window.ea.loadBackupData(backupPath) as Promise<string>;
  }

  async loadBackupAndroid(): Promise<string> {
    // Restore from the newest usable ring slot (#7901). The Android bridge can
    // hand back literal newlines, so we escape them here (the single escape site)
    // and judge usability on that parse-ready form; the returned string is ready
    // for JSON.parse. Returns '' when nothing usable exists (degrades to the
    // existing import-error snack rather than throwing on the startup path).
    const [primaryRaw, prevRaw] = await Promise.all([
      androidInterface.loadFromDbWrapped(ANDROID_DB_KEY),
      androidInterface.loadFromDbWrapped(ANDROID_DB_KEY_PREV),
    ]);
    const best = selectBestBackupStr(
      this._escapeAndroidNewlines(primaryRaw),
      this._escapeAndroidNewlines(prevRaw),
    );
    return best ?? '';
  }

  async loadBackupIOS(): Promise<string> {
    const [primary, prev] = await Promise.all([
      this._readIOSFileOrNull(IOS_BACKUP_FILENAME),
      this._readIOSFileOrNull(IOS_BACKUP_PREV_FILENAME),
    ]);
    // Mirror loadBackupAndroid: return '' rather than throwing when nothing
    // usable exists. askForFileStoreBackupIfAvailable() runs from the
    // fire-and-forget _initBackups() at startup, so a throw here would surface as
    // an unhandled rejection; '' instead flows to the existing import-error snack.
    return selectBestBackupStr(primary, prev) ?? '';
  }

  private async _checkBackupAvailableIOS(): Promise<boolean> {
    // Available if either ring slot exists (#7901).
    const [primary, prev] = await Promise.all([
      this._iosFileExists(IOS_BACKUP_FILENAME),
      this._iosFileExists(IOS_BACKUP_PREV_FILENAME),
    ]);
    return primary || prev;
  }

  async askForFileStoreBackupIfAvailable(): Promise<void> {
    if (!IS_ELECTRON && !IS_ANDROID_WEB_VIEW && !this._platformService.isIOS()) {
      return;
    }

    // ELECTRON — has its own rotated meta (folder + date) in the prompt.
    if (IS_ELECTRON) {
      const backupMeta = await this.checkBackupAvailable();
      if (typeof backupMeta !== 'boolean') {
        if (
          confirmDialog(
            this._translateService.instant(T.CONFIRM.RESTORE_FILE_BACKUP, {
              dir: backupMeta.folder,
              from: new Date(backupMeta.created).toLocaleString(),
            }),
          )
        ) {
          const backupData = await this.loadBackupElectron(backupMeta.path);
          Log.log('backupData loaded from Electron backup');
          await this._importBackup(backupData);
        }
      }
      return;
    }

    // MOBILE (Android / iOS) — load the best ring generation first so the prompt
    // can tell the user what they would restore (#7901). Loading is cheap and
    // lets a blind "discard my data?" dialog become an informed one — they should
    // never dismiss the only copy of their data without seeing it exists.
    const backupData = IS_ANDROID_WEB_VIEW
      ? await this.loadBackupAndroid()
      : await this.loadBackupIOS();
    if (!backupData) {
      // Nothing usable to restore — stay silent rather than prompt for nothing.
      return;
    }
    if (confirmDialog(this._restoreMobilePromptMsg(backupData))) {
      Log.log('mobile backupData loaded, length: ' + backupData.length);
      await this._importBackup(backupData);
    }
  }

  /**
   * Builds the mobile restore prompt. When the backup parses, it names the task
   * and project counts so the user can judge what they would restore; otherwise
   * falls back to the generic prompt.
   */
  private _restoreMobilePromptMsg(backupData: string): string {
    const summary = summarizeBackupStr(backupData);
    if (!summary) {
      return this._translateService.instant(T.CONFIRM.RESTORE_FILE_BACKUP_ANDROID);
    }
    return this._translateService.instant(T.CONFIRM.RESTORE_FILE_BACKUP_MOBILE, {
      tasks: summary.taskCount,
      projects: summary.projectCount,
    });
  }

  private async _backup(): Promise<void> {
    // Use async method to include archives from IndexedDB (not empty DEFAULT_ARCHIVE)
    const data =
      (await this._stateSnapshotService.getAllSyncModelDataFromStoreAsync()) as AppDataComplete;

    // GUARD (#7901/#7892): never overwrite a good on-device backup with an
    // empty/degraded store. The local backups live in durable, non-evictable
    // storage (Android SQLite KeyValStore, iOS file, Electron file), but after a
    // WebView IndexedDB eviction the live NgRx store can boot empty — and the
    // 5-min timer would then clobber the last good backup with nothing. Skipping
    // the write is always safe: the previous backup stays intact (this mirrors
    // the snapshot/compaction empty-overwrite guard). Trade-off: a deliberate
    // full wipe is not captured in the local backup until real data exists again.
    if (!hasMeaningfulStateData(data)) {
      Log.warn(
        'LocalBackupService: Skipping backup — current state has no meaningful ' +
          'data (refusing to overwrite backup with empty state)',
      );
      return;
    }

    if (IS_ELECTRON) {
      // Electron keeps its own rotated, timestamped backups (electron/backup.ts),
      // so it needs no ring here. The A3 guard is mobile-only — Electron's
      // backup chain is not a single-slot overwrite.
      window.ea.backupAppData(data);
    }
    if (IS_ANDROID_WEB_VIEW) {
      await this._backupAndroid(data);
    }
    if (this._platformService.isIOS()) {
      await this._backupIOS(data);
    }
  }

  /**
   * A3 (#7925): returns true when writing `newData` over `existingRaw` would
   * shrink a substantial backup to a near-empty one — the post-eviction
   * "boot empty, user adds 1–2 tasks, timer fires" pattern. Returns false
   * (allow the write) when there is no existing backup, when the existing
   * blob is empty/corrupt (so we don't block the first ever capture), or
   * when the new snapshot is not near-empty.
   */
  private _isNearEmptyOverwrite(
    newData: AppDataComplete,
    existingRaw: string | null,
  ): boolean {
    const newTaskCount = countAllTasks(newData);
    if (newTaskCount >= NEAR_EMPTY_NEW_TASKS) {
      return false;
    }
    const existingTaskCount = countAllTasksInBackupStr(existingRaw);
    if (existingTaskCount === null) {
      return false;
    }
    return existingTaskCount >= SUBSTANTIAL_EXISTING_TASKS;
  }

  /**
   * Android two-generation ring (#7901): promote the current backup to the prev
   * slot before overwriting it, so a single bad write can't erase the only copy.
   * A3 guard (#7925) skips the overwrite when the snapshot is near-empty
   * vs. a substantial existing backup.
   */
  private async _backupAndroid(data: AppDataComplete): Promise<void> {
    const existingRaw = await androidInterface.loadFromDbWrapped(ANDROID_DB_KEY);
    const existing = this._escapeAndroidNewlines(existingRaw);
    if (this._isNearEmptyOverwrite(data, existing)) {
      Log.warn(
        'LocalBackupService: Skipping Android backup — near-empty snapshot ' +
          `(${countAllTasks(data)} tasks) would overwrite a substantial backup ` +
          `(${countAllTasksInBackupStr(existing)} tasks). #7925 A3 guard.`,
      );
      return;
    }
    if (existingRaw) {
      await androidInterface.saveToDbWrapped(ANDROID_DB_KEY_PREV, existingRaw);
    }
    await androidInterface.saveToDbWrapped(ANDROID_DB_KEY, JSON.stringify(data));
  }

  private async _backupIOS(data: AppDataComplete): Promise<void> {
    try {
      // Two-generation ring (#7901): promote the current backup file to the prev
      // slot before overwriting, so a single bad write can't erase the only copy.
      const existing = await this._readIOSFileOrNull(IOS_BACKUP_FILENAME);
      if (this._isNearEmptyOverwrite(data, existing)) {
        Log.warn(
          'LocalBackupService: Skipping iOS backup — near-empty snapshot ' +
            `(${countAllTasks(data)} tasks) would overwrite a substantial backup ` +
            `(${countAllTasksInBackupStr(existing)} tasks). #7925 A3 guard.`,
        );
        return;
      }
      if (existing) {
        await this._writeIOSFile(IOS_BACKUP_PREV_FILENAME, existing);
      }
      await this._writeIOSFile(IOS_BACKUP_FILENAME, JSON.stringify(data));
      Log.log('iOS backup saved successfully');
    } catch (error) {
      Log.err('Failed to save iOS backup', error);
    }
  }

  private async _writeIOSFile(path: string, data: string): Promise<void> {
    await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  }

  /** Re-escapes literal newlines from the Android bridge so the blob parses as JSON. */
  private _escapeAndroidNewlines(raw: string | null): string | null {
    return raw === null ? null : raw.replace(/\n/g, '\\n');
  }

  private async _readIOSFileOrNull(path: string): Promise<string | null> {
    try {
      const result = await Filesystem.readFile({
        path,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return result.data as string;
    } catch {
      // File doesn't exist
      return null;
    }
  }

  private async _iosFileExists(path: string): Promise<boolean> {
    try {
      return !!(await Filesystem.stat({ path, directory: Directory.Data }));
    } catch {
      return false;
    }
  }

  private async _importBackup(backupData: string): Promise<void> {
    try {
      // isForceConflict=true only gates page reload; fresh clock is always generated
      await this._backupService.importCompleteBackup(
        JSON.parse(backupData) as AppDataComplete,
        false,
        true,
        true,
      );
    } catch (e) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_IMPORT_FAILED,
      });
      return;
    }
  }
}
