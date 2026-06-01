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
// A2 (#7925): high enough that a flurry of UI actions settles into one backup;
// low enough that a real change is captured before the user backgrounds the app.
const DATA_CHANGE_BACKUP_DEBOUNCE = 30 * 1000;
const ANDROID_DB_KEY = 'backup';
// Previous-generation slot for the two-generation ring (#7901).
const ANDROID_DB_KEY_PREV = 'backup_prev';
const IOS_BACKUP_FILENAME = 'super-productivity-backup.json';
const IOS_BACKUP_PREV_FILENAME = 'super-productivity-backup.prev.json';

// A3 (#7925) near-empty write-time overwrite guard thresholds. Starting point
// — revisit once A1 telemetry shows what a real post-eviction boot looks like.
const NEAR_EMPTY_NEW_TASKS = 3;
const SUBSTANTIAL_EXISTING_TASKS = 10;

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
  // A2 (#7925): the empty-state guard in `_backup()` plus A3's near-empty
  // guard keep degraded data out — `bulkApplyOperations` / `loadAllData`
  // do transit LOCAL_ACTIONS (they aren't tagged `meta.isRemote`), and
  // that's fine because the downstream guards handle it.
  private _triggerBackupSave$: Observable<unknown> = this._cfg$.pipe(
    switchMap((cfg) =>
      cfg.isEnabled
        ? merge(
            interval(DEFAULT_BACKUP_INTERVAL),
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
    // Restore from the newest usable ring slot (#7901). Returns '' when nothing
    // usable exists (degrades to the existing import-error snack rather than
    // throwing on the startup path).
    const [primary, prev] = await Promise.all([
      androidInterface.loadFromDbWrapped(ANDROID_DB_KEY),
      androidInterface.loadFromDbWrapped(ANDROID_DB_KEY_PREV),
    ]);
    return selectBestBackupStr(primary, prev) ?? '';
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

    // #7901/#7892: don't overwrite a good backup with an empty store (a
    // post-eviction WebView can boot blank). A3 (#7925) extends this to
    // "near-empty over substantial" inside each platform writer.
    if (!hasMeaningfulStateData(data)) {
      Log.warn('LocalBackupService: skipping backup — empty state');
      return;
    }

    if (IS_ELECTRON) {
      // Electron has its own rotated, timestamped chain — no ring or A3 guard
      // needed (the bug class A3 protects against doesn't apply).
      window.ea.backupAppData(data);
    }
    if (IS_ANDROID_WEB_VIEW) {
      await this._backupAndroid(data);
    }
    if (this._platformService.isIOS()) {
      await this._backupIOS(data);
    }
  }

  // A3 (#7925) pure predicate — kept on its own so the threshold logic is
  // testable independent of the platform I/O paths.
  private _isNearEmptyOverwrite(
    newData: AppDataComplete,
    existingRaw: string | null,
  ): boolean {
    if (countAllTasks(newData) >= NEAR_EMPTY_NEW_TASKS) {
      return false;
    }
    const existingTaskCount = countAllTasksInBackupStr(existingRaw);
    if (existingTaskCount === null) {
      return false;
    }
    return existingTaskCount >= SUBSTANTIAL_EXISTING_TASKS;
  }

  // Single source of the A3 skip log; returns true when the caller should bail.
  private _guardNearEmptyOverwrite(
    data: AppDataComplete,
    existing: string | null,
    platform: 'Android' | 'iOS',
  ): boolean {
    if (!this._isNearEmptyOverwrite(data, existing)) {
      return false;
    }
    Log.warn(
      `LocalBackupService: skipping ${platform} backup — near-empty ` +
        `(${countAllTasks(data)} tasks) over substantial backup ` +
        `(${countAllTasksInBackupStr(existing)} tasks). #7925 A3.`,
    );
    return true;
  }

  private async _backupAndroid(data: AppDataComplete): Promise<void> {
    const existing = await androidInterface.loadFromDbWrapped(ANDROID_DB_KEY);
    if (this._guardNearEmptyOverwrite(data, existing, 'Android')) return;
    if (existing) {
      await androidInterface.saveToDbWrapped(ANDROID_DB_KEY_PREV, existing);
    }
    await androidInterface.saveToDbWrapped(ANDROID_DB_KEY, JSON.stringify(data));
  }

  private async _backupIOS(data: AppDataComplete): Promise<void> {
    try {
      const existing = await this._readIOSFileOrNull(IOS_BACKUP_FILENAME);
      if (this._guardNearEmptyOverwrite(data, existing, 'iOS')) return;
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
