import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { EMPTY, firstValueFrom, interval, merge, Observable } from 'rxjs';
import { LocalBackupConfig } from '../../features/config/global-config.model';
import { debounceTime, map, switchMap, tap } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { LocalBackupMeta } from './local-backup.model';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';
import { IS_ELECTRON } from '../../app.constants';
import { androidInterface } from '../../features/android/android-interface';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { T } from '../../t.const';
import { TranslateService } from '@ngx-translate/core';
import { AppDataComplete } from '../../op-log/model/model-config';
import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import {
  backupStrHasSyncEnabled,
  countAllTasks,
  countAllTasksInBackupStr,
  isUsableBackupStr,
  selectBestBackupStr,
  summarizeBackupStr,
} from './backup-ring.util';
import { DEFAULT_MAX_BACKUP_FILES } from '../../../../electron/shared-with-frontend/backup-file-cleanup.util';
import { SnackService } from '../../core/snack/snack.service';
import { Log } from '../../core/log';
import { confirmDialog } from '../../util/native-dialogs';
import { CapacitorPlatformService } from '../../core/platform/capacitor-platform.service';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { LS } from '../../core/persistence/storage-keys.const';

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
  private _isAndroidWebView = inject(IS_ANDROID_WEB_VIEW_TOKEN);

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
    if (this._isAndroidWebView) {
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

  /** Newest usable backup blob for the current mobile platform ('' if none). */
  private _loadBestMobileBackupStr(): Promise<string> {
    return this._isAndroidWebView ? this.loadBackupAndroid() : this.loadBackupIOS();
  }

  private async _checkBackupAvailableIOS(): Promise<boolean> {
    // Available if either ring slot exists (#7901).
    const [primary, prev] = await Promise.all([
      this._iosFileExists(IOS_BACKUP_FILENAME),
      this._iosFileExists(IOS_BACKUP_PREV_FILENAME),
    ]);
    return primary || prev;
  }

  /**
   * Startup recovery entry point. PRECONDITION (enforced by the only caller,
   * StartupService._initBackups): invoke only when the live store is genuinely
   * blank — no state cache AND an empty op-log. The mobile branch may restore a
   * backup *without a prompt*, which is a destructive op-log replacement; that is
   * only safe because the empty op-log means the concurrent hydrator has nothing
   * to replay and cannot be raced. Do NOT call this from a path where real ops
   * may exist. See #7901.
   */
  async askForFileStoreBackupIfAvailable(): Promise<void> {
    if (!IS_ELECTRON && !this._isAndroidWebView && !this._platformService.isIOS()) {
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

    // MOBILE (Android / iOS) — recovery path. StartupService only calls this when
    // there is no state cache AND the op-log is empty (see _initBackups), i.e. a
    // genuinely blank store — in practice WebView IndexedDB eviction (#7901/#7892)
    // or a fresh install. Because the op-log is empty, the concurrently-running
    // hydrator has nothing to replay, so a destructive import cannot race it.
    //
    // Auto-restore WITHOUT a prompt only for a *usable* backup that had *no sync
    // configured*. Restoring a synced backup resets `lastServerSeq` and writes a
    // clean-slate BACKUP_IMPORT, which can silently drop other devices' concurrent
    // work — so a synced backup must go through the informed prompt and let the
    // user decide (they may prefer to re-pull from the server). Corrupt /
    // data-less / synced backups all fall through to the prompt below.
    const backupData = await this._loadBestMobileBackupStr();
    if (!backupData) {
      // Nothing usable to restore — stay silent rather than prompt for nothing.
      return;
    }
    if (isUsableBackupStr(backupData) && !backupStrHasSyncEnabled(backupData)) {
      Log.log('mobile backupData auto-restored, length: ' + backupData.length);
      const didImport = await this._importBackup(backupData);
      if (didImport) {
        const summary = summarizeBackupStr(backupData);
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.GCF.AUTO_BACKUPS.S_AUTO_RESTORED,
          translateParams: {
            tasks: summary?.taskCount ?? 0,
            projects: summary?.projectCount ?? 0,
          },
        });
      }
      return;
    }
    // Corrupt, data-less, or sync-configured backup: don't silently act — surface
    // the informed prompt so the user decides.
    if (confirmDialog(this._restoreMobilePromptMsg(backupData))) {
      Log.log('mobile backupData loaded, length: ' + backupData.length);
      await this._importBackup(backupData);
    }
  }

  async restoreLatestMobileBackupFromSettings(): Promise<void> {
    // iOS is supported here so the method works on either mobile platform, but
    // the Settings action is currently only wired up for Android (#8066 scope);
    // see config-page.component.ts. iOS stays future-proof, not dead.
    if (!this._isAndroidWebView && !this._platformService.isIOS()) {
      return;
    }

    const backupData = await this._loadBestMobileBackupStr();

    // Not redundant with loadBackup*: selectBestBackupStr falls back to a
    // non-empty *corrupt* blob when neither ring slot is usable, so this gate is
    // what rejects corrupt data and surfaces the snack instead of attempting a
    // doomed import. Don't "simplify" to `!backupData`.
    if (!isUsableBackupStr(backupData)) {
      this._snackService.open({
        type: 'WARNING',
        msg: T.GCF.AUTO_BACKUPS.S_NO_BACKUP_AVAILABLE,
      });
      return;
    }

    if (confirmDialog(this._restoreMobileFromSettingsPromptMsg(backupData))) {
      Log.log('mobile backupData loaded from settings, length: ' + backupData.length);
      const didImport = await this._importBackup(backupData);
      if (didImport) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.GCF.AUTO_BACKUPS.S_RESTORE_SUCCESS,
        });
      }
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

  private _restoreMobileFromSettingsPromptMsg(backupData: string): string {
    const summary = summarizeBackupStr(backupData);
    return this._translateService.instant(
      T.CONFIRM.RESTORE_FILE_BACKUP_MOBILE_FROM_SETTINGS,
      {
        tasks: summary?.taskCount ?? 0,
        projects: summary?.projectCount ?? 0,
      },
    );
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

    let didWrite = false;
    if (IS_ELECTRON) {
      // Electron has its own rotated, timestamped chain — no ring or A3 guard
      // needed (the bug class A3 protects against doesn't apply).
      await this._backupElectron(data);
      didWrite = true;
    }
    if (this._isAndroidWebView && (await this._backupAndroid(data))) {
      didWrite = true;
    }
    if (this._platformService.isIOS() && (await this._backupIOS(data))) {
      didWrite = true;
    }

    // #7901: record when a good backup was actually written so Settings can show
    // the user they're protected. Only on a real write: the per-platform A3
    // near-empty guard (#7925) can skip the write to preserve an older, larger
    // backup, and the timestamp must not advance then — it would falsely claim
    // "just backed up" on exactly the post-eviction boot the guard protects.
    if (didWrite) {
      this._recordLastBackupTime();
    }
  }

  private _recordLastBackupTime(): void {
    try {
      localStorage.setItem(LS.LAST_LOCAL_BACKUP, Date.now().toString());
    } catch (e) {
      Log.warn('LocalBackupService: failed to record last backup time', e);
    }
  }

  /** Epoch ms of the last successful local backup write, or null if none yet. */
  getLastBackupTime(): number | null {
    const raw = localStorage.getItem(LS.LAST_LOCAL_BACKUP);
    if (!raw) {
      return null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private async _backupElectron(data: AppDataComplete): Promise<void> {
    const cfg = await firstValueFrom(this._cfg$);
    window.ea.backupAppData({
      data,
      maxBackupFiles: cfg.maxBackupFiles ?? DEFAULT_MAX_BACKUP_FILES,
    });
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

  // Returns true when a backup was actually written, false when the A3 guard
  // skipped it (so the caller knows whether to advance the last-backup time).
  private async _backupAndroid(data: AppDataComplete): Promise<boolean> {
    const existing = await androidInterface.loadFromDbWrapped(ANDROID_DB_KEY);
    if (this._guardNearEmptyOverwrite(data, existing, 'Android')) {
      return false;
    }
    if (existing) {
      await androidInterface.saveToDbWrapped(ANDROID_DB_KEY_PREV, existing);
    }
    await androidInterface.saveToDbWrapped(ANDROID_DB_KEY, JSON.stringify(data));
    return true;
  }

  // Returns true when a backup was actually written, false when the A3 guard
  // skipped it or the write failed.
  private async _backupIOS(data: AppDataComplete): Promise<boolean> {
    try {
      const existing = await this._readIOSFileOrNull(IOS_BACKUP_FILENAME);
      if (this._guardNearEmptyOverwrite(data, existing, 'iOS')) {
        return false;
      }
      if (existing) {
        await this._writeIOSFile(IOS_BACKUP_PREV_FILENAME, existing);
      }
      await this._writeIOSFile(IOS_BACKUP_FILENAME, JSON.stringify(data));
      Log.log('iOS backup saved successfully');
      return true;
    } catch (error) {
      Log.err('Failed to save iOS backup', error);
      return false;
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

  private async _importBackup(backupData: string): Promise<boolean> {
    try {
      // isForceConflict=true only gates page reload; fresh clock is always generated
      await this._backupService.importCompleteBackup(
        JSON.parse(backupData) as AppDataComplete,
        false,
        true,
        true,
      );
      return true;
    } catch (e) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_IMPORT_FAILED,
      });
      return false;
    }
  }
}
