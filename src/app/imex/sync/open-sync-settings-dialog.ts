import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SyncConfig } from '../../features/config/global-config.model';

/** Sync counts as set up once it is on with a provider chosen. */
export const isSyncSetUp = (sync: SyncConfig | undefined): boolean =>
  !!sync?.isEnabled && !!sync.syncProvider;

/**
 * Opens the sign-in dialog while sync is off (first setup), else the sync
 * settings. The sign-in dialog leads to the settings for other providers.
 */
export const openSyncSettingsDialog = async (
  matDialog: MatDialog,
  sync: SyncConfig | undefined,
): Promise<MatDialogRef<unknown>> => {
  if (isSyncSetUp(sync)) {
    const { DialogSyncCfgComponent } =
      await import('./dialog-sync-cfg/dialog-sync-cfg.component');
    return matDialog.open(DialogSyncCfgComponent);
  }
  const { DialogSyncSetupComponent } =
    await import('./dialog-sync-setup/dialog-sync-setup.component');
  return matDialog.open(DialogSyncSetupComponent);
};
