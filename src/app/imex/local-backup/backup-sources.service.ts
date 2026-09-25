import { inject, Injectable } from '@angular/core';
import { IS_ELECTRON } from '../../app.constants';
import { LocalDraftService } from '../../core/draft/local-draft.service';
import { Log } from '../../core/log';
import { BackupService } from '../../op-log/backup/backup.service';
import { ImportBackupReason } from '../../op-log/persistence/operation-log-store.service';
import { T } from '../../t.const';
import { countAllTasksInBackupStr } from './backup-ring.util';
import { LocalBackupService } from './local-backup.service';

export type BackupSourceKind = 'RECOVERY_POINT' | 'BACKUP_FILE' | 'MOBILE_SLOT';

/** One row of the Settings → backups list, independent of where it is stored. */
export interface BackupListEntry {
  id: string;
  kind: BackupSourceKind;
  /** backupId, file path, or mobile slot name — what `restore()` needs. */
  ref: string;
  /** Translation key; file rows carry their verbatim file name in `name`. */
  label: string;
  name?: string;
  createdAt: number | null;
  /** null until `loadTaskCount()` resolved it (file / mobile slots). */
  taskCount: number | null;
}

const REASON_LABEL: Record<ImportBackupReason, string> = {
  REMOTE_IMPORT: T.GCF.AUTO_BACKUPS.D_LIST.REASON_REMOTE_IMPORT,
  FORCE_DOWNLOAD: T.GCF.AUTO_BACKUPS.D_LIST.REASON_FORCE_DOWNLOAD,
  LOCAL_IMPORT: T.GCF.AUTO_BACKUPS.D_LIST.REASON_LOCAL_IMPORT,
};

/** Everything that could be listed, plus which sources could not be read. */
export interface BackupListResult {
  entries: BackupListEntry[];
  failedSources: BackupSourceKind[];
}

const byNewestFirst = (a: BackupListEntry, b: BackupListEntry): number =>
  (b.createdAt ?? -1) - (a.createdAt ?? -1);

/**
 * Aggregates every backup this device holds — the recovery ring, Electron
 * backup files and the mobile ring slots — behind one list + restore API
 * (docs/sync-and-op-log/local-recovery-points.md).
 */
@Injectable()
export class BackupSourcesService {
  private _backupService = inject(BackupService);
  private _localBackupService = inject(LocalBackupService);
  private _localDraftService = inject(LocalDraftService);
  // Mobile blobs are read once per list call and kept for count/restore. The
  // service is provided by the dialog, so they are released with it.
  private _mobileBlobs = new Map<string, string>();

  /**
   * One failing source must not hide the others (a closed IndexedDB vs. the
   * file dir); the failure is reported so the UI can say the list is partial.
   */
  async listBackups(): Promise<BackupListResult> {
    const failedSources: BackupSourceKind[] = [];
    const listOrEmpty = async (
      kind: BackupSourceKind,
      list: () => Promise<BackupListEntry[]>,
    ): Promise<BackupListEntry[]> => {
      try {
        return await list();
      } catch (e) {
        Log.err('BackupSourcesService: listing failed', {
          kind,
          name: (e as Error | undefined)?.name,
        });
        failedSources.push(kind);
        return [];
      }
    };
    const lists = await Promise.all([
      listOrEmpty('RECOVERY_POINT', () => this._listRecoveryPoints()),
      listOrEmpty('BACKUP_FILE', () => this._listBackupFiles()),
      listOrEmpty('MOBILE_SLOT', () => this._listMobileSlots()),
    ]);
    return { entries: lists.flat().sort(byNewestFirst), failedSources };
  }

  /** Resolves the task count lazily; the blob is parsed only for the selected row. */
  async loadTaskCount(entry: BackupListEntry): Promise<number | null> {
    if (entry.taskCount !== null) {
      return entry.taskCount;
    }
    return countAllTasksInBackupStr(await this._loadBlob(entry));
  }

  async restore(entry: BackupListEntry): Promise<boolean> {
    if (entry.kind !== 'RECOVERY_POINT') {
      const blob = await this._loadBlob(entry);
      return blob ? this._localBackupService.restoreBackupStr(blob) : false;
    }
    const didRestore = await this._backupService.restoreImportBackupById(entry.ref);
    if (didRestore) {
      // Same post-import cleanup as every other wholesale replacement: note
      // drafts refer to content that no longer exists.
      this._localDraftService.deleteAllDrafts();
    }
    return didRestore;
  }

  private async _loadBlob(entry: BackupListEntry): Promise<string | null> {
    switch (entry.kind) {
      case 'BACKUP_FILE':
        return this._localBackupService.loadBackupElectron(entry.ref);
      case 'MOBILE_SLOT':
        return this._mobileBlobs.get(entry.ref) ?? null;
      default:
        return null;
    }
  }

  private async _listRecoveryPoints(): Promise<BackupListEntry[]> {
    return (await this._backupService.listImportBackups()).map((meta) => ({
      id: `RECOVERY_POINT:${meta.backupId}`,
      kind: 'RECOVERY_POINT',
      ref: meta.backupId,
      label: REASON_LABEL[meta.reason],
      createdAt: meta.savedAt,
      taskCount: meta.taskCount,
    }));
  }

  private async _listBackupFiles(): Promise<BackupListEntry[]> {
    if (!IS_ELECTRON) {
      return [];
    }
    return (await window.ea.listBackups()).map((file) => ({
      id: `BACKUP_FILE:${file.path}`,
      kind: 'BACKUP_FILE',
      ref: file.path,
      label: T.GCF.AUTO_BACKUPS.D_LIST.KIND_FILE,
      name: file.name,
      createdAt: file.created,
      taskCount: null,
    }));
  }

  private async _listMobileSlots(): Promise<BackupListEntry[]> {
    const slots = await this._localBackupService.listMobileBackupSlots();
    this._mobileBlobs = new Map(slots.map((s) => [s.slot, s.data]));
    return slots.map((s) => ({
      id: `MOBILE_SLOT:${s.slot}`,
      kind: 'MOBILE_SLOT',
      ref: s.slot,
      label:
        s.slot === 'latest'
          ? T.GCF.AUTO_BACKUPS.D_LIST.SLOT_LATEST
          : T.GCF.AUTO_BACKUPS.D_LIST.SLOT_PREVIOUS,
      createdAt:
        s.slot === 'latest' ? this._localBackupService.getLastBackupTime() : null,
      taskCount: null,
    }));
  }
}
