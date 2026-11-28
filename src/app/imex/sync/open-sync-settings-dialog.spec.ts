import { MatDialog } from '@angular/material/dialog';
import { SyncConfig } from '../../features/config/global-config.model';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { DialogSyncCfgComponent } from './dialog-sync-cfg/dialog-sync-cfg.component';
import { DialogSyncSetupComponent } from './dialog-sync-setup/dialog-sync-setup.component';
import { openSyncSettingsDialog } from './open-sync-settings-dialog';

describe('openSyncSettingsDialog', () => {
  let matDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(() => {
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
  });

  it('opens the sign-in dialog while sync is off or has no provider', async () => {
    for (const sync of [
      undefined,
      { isEnabled: false, syncProvider: SyncProviderId.WebDAV },
      { isEnabled: true, syncProvider: null },
    ]) {
      matDialog.open.calls.reset();
      await openSyncSettingsDialog(matDialog, sync as SyncConfig | undefined);
      expect(matDialog.open).toHaveBeenCalledWith(DialogSyncSetupComponent);
    }
  });

  it('opens the sync settings once sync is set up', async () => {
    const sync = { isEnabled: true, syncProvider: SyncProviderId.SuperSync };
    await openSyncSettingsDialog(matDialog, sync as SyncConfig);
    expect(matDialog.open).toHaveBeenCalledWith(DialogSyncCfgComponent);
  });
});
