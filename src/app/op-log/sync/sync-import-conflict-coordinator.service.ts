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

type SyncImportConflictActions = {
  useLocal: () => Promise<void>;
  useRemote: () => Promise<void>;
};

@Injectable({
  providedIn: 'root',
})
export class SyncImportConflictCoordinatorService {
  private syncImportConflictDialogService = inject(SyncImportConflictDialogService);
  private serverMigrationService = inject(ServerMigrationService);
  private uploadService = inject(OperationLogUploadService);

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
        await actions.useLocal();
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

  async forceUploadLocalState(syncProvider: OperationSyncCapable): Promise<void> {
    OpLog.warn(
      'SyncImportConflictCoordinatorService: Force uploading local state - creating SYNC_IMPORT to override remote.',
    );

    await this.serverMigrationService.handleServerMigration(syncProvider, {
      skipServerEmptyCheck: true,
      syncImportReason: 'FORCE_UPLOAD',
    });

    await this.uploadService.uploadPendingOps(syncProvider, {
      skipPiggybackProcessing: true,
      isCleanSlate: true,
    });

    OpLog.normal('SyncImportConflictCoordinatorService: Force upload complete.');
  }
}
