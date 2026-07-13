import { inject, Injectable } from '@angular/core';
import { OpLog } from '../../core/log';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import {
  SyncImportConflictData,
  SyncImportConflictResolution,
} from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';
import { OperationLogUploadService } from './operation-log-upload.service';
import { ServerMigrationService } from './server-migration.service';
import { SyncImportConflictDialogService } from './sync-import-conflict-dialog.service';
import {
  EncryptNoPasswordError,
  ForceUploadFailedError,
  ForceUploadPendingOpsError,
} from '../core/errors/sync-errors';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';

type SyncImportConflictActions = {
  useLocal: () => Promise<ForceUploadResult>;
  useRemote: () => Promise<void>;
};

export interface ForceUploadResult {
  readonly hasUnresolvedOps: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class SyncImportConflictCoordinatorService {
  private syncImportConflictDialogService = inject(SyncImportConflictDialogService);
  private serverMigrationService = inject(ServerMigrationService);
  private uploadService = inject(OperationLogUploadService);
  private opLogStore = inject(OperationLogStoreService);

  async handleSyncImportConflict(
    dialogData: SyncImportConflictData,
    logPrefix: string,
    actions: SyncImportConflictActions,
  ): Promise<SyncImportConflictResolution> {
    const resolution =
      await this.syncImportConflictDialogService.showConflictDialog(dialogData);

    switch (resolution) {
      case 'USE_LOCAL':
        OpLog.normal(`${logPrefix}: User chose USE_LOCAL. Force uploading local state.`);
        if ((await actions.useLocal()).hasUnresolvedOps) {
          throw new ForceUploadPendingOpsError(
            'Force upload succeeded with operations still pending.',
          );
        }
        return 'USE_LOCAL';
      case 'USE_REMOTE':
        OpLog.normal(
          `${logPrefix}: User chose USE_REMOTE. Force downloading remote state.`,
        );
        await actions.useRemote();
        return 'USE_REMOTE';
      case 'CANCEL':
      default:
        OpLog.normal(`${logPrefix}: User cancelled SYNC_IMPORT conflict resolution.`);
        return 'CANCEL';
    }
  }

  async forceUploadLocalState(
    syncProvider: OperationSyncCapable,
  ): Promise<ForceUploadResult> {
    OpLog.warn(
      'SyncImportConflictCoordinatorService: Force uploading local state - creating SYNC_IMPORT to override remote.',
    );

    const forceUploadOpId = await this.serverMigrationService.handleServerMigration(
      syncProvider,
      {
        skipServerEmptyCheck: true,
        syncImportReason: 'FORCE_UPLOAD',
      },
    );

    if (!forceUploadOpId) {
      throw new ForceUploadFailedError(
        'Force upload failed because no SYNC_IMPORT was created.',
      );
    }

    const uploadResult = await this.uploadService.uploadPendingOps(syncProvider, {
      skipPiggybackProcessing: true,
      isCleanSlate: true,
    });

    if (uploadResult.encryptionRequiredKeyMissing) {
      throw new EncryptNoPasswordError(
        'Force upload requires an encryption key, but none is configured.',
      );
    }

    const forceUploadEntry = await this.opLogStore.getOpById(forceUploadOpId);
    if (!forceUploadEntry?.syncedAt) {
      throw new ForceUploadFailedError(
        'Force upload failed because the SYNC_IMPORT was not accepted.',
      );
    }

    OpLog.normal('SyncImportConflictCoordinatorService: Force upload complete.');
    return { hasUnresolvedOps: uploadResult.rejectedCount > 0 };
  }
}
