import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { EMPTY, interval, Observable } from 'rxjs';
import { LocalBackupConfig } from '../../features/config/global-config.model';
import { map, switchMap, tap } from 'rxjs/operators';
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
import { selectBestBackupStr, summarizeBackupStr } from './backup-ring.util';
import { SnackService } from '../../core/snack/snack.service';
import { Log } from '../../core/log';
import { confirmDialog } from '../../util/native-dialogs';
import { CapacitorPlatformService } from '../../core/platform/capacitor-platform.service';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const DEFAULT_BACKUP_INTERVAL = 5 * 60 * 1000;
const ANDROID_DB_KEY = 'backup';
// Previous-generation slot for the two-generation ring (#7901): the current
// `backup` is promoted here before being overwritten, so one bad/corrupt write
// cycle can never erase the only good copy.
const ANDROID_DB_KEY_PREV = 'backup_prev';
const IOS_BACKUP_FILENAME = 'super-productivity-backup.json';
const IOS_BACKUP_PREV_FILENAME = 'super-productivity-backup.prev.json';

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

  private _cfg$: Observable<LocalBackupConfig> = this._configService.cfg$.pipe(
    map((cfg) => cfg.localBackup),
  );
  private _triggerBackupSave$: Observable<unknown> = this._cfg$.pipe(
    switchMap((cfg) => (cfg.isEnabled ? interval(DEFAULT_BACKUP_INTERVAL) : EMPTY)),
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
      // so it needs no ring here.
      window.ea.backupAppData(data);
    }
    if (IS_ANDROID_WEB_VIEW) {
      await this._backupAndroid(JSON.stringify(data));
    }
    if (this._platformService.isIOS()) {
      await this._backupIOS(data);
    }
  }

  /**
   * Android two-generation ring (#7901): promote the current backup to the prev
   * slot before overwriting it, so a single bad write can't erase the only copy.
   */
  private async _backupAndroid(dataStr: string): Promise<void> {
    const existing = await androidInterface.loadFromDbWrapped(ANDROID_DB_KEY);
    if (existing) {
      await androidInterface.saveToDbWrapped(ANDROID_DB_KEY_PREV, existing);
    }
    await androidInterface.saveToDbWrapped(ANDROID_DB_KEY, dataStr);
  }

  private async _backupIOS(data: AppDataComplete): Promise<void> {
    try {
      // Two-generation ring (#7901): promote the current backup file to the prev
      // slot before overwriting, so a single bad write can't erase the only copy.
      const existing = await this._readIOSFileOrNull(IOS_BACKUP_FILENAME);
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
