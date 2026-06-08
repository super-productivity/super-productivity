import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DEFAULT_PROJECT } from '../../project/project.const';
import { DialogWorkContextSettingsComponent } from './dialog-work-context-settings.component';
import {
  openWorkContextSettingsDialog,
  WORK_CONTEXT_SETTINGS_DIALOG_CONFIG,
} from './open-work-context-settings-dialog';
import type { WorkContextSettingsDialogData } from './dialog-work-context-settings.component';

describe('openWorkContextSettingsDialog', () => {
  it('uses a shared responsive width for project and tag settings dialogs', () => {
    expect(WORK_CONTEXT_SETTINGS_DIALOG_CONFIG).toEqual({
      restoreFocus: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      width: '600px',
      maxWidth: '95vw',
    });
  });

  it('opens the dialog with the shared size config and caller data', async () => {
    const matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    matDialog.open.and.returnValue(
      {} as MatDialogRef<DialogWorkContextSettingsComponent>,
    );
    const data: WorkContextSettingsDialogData = {
      isProject: true,
      entity: DEFAULT_PROJECT,
    };

    await openWorkContextSettingsDialog(matDialog, data);

    expect(matDialog.open).toHaveBeenCalledOnceWith(DialogWorkContextSettingsComponent, {
      ...WORK_CONTEXT_SETTINGS_DIALOG_CONFIG,
      data,
    });
  });
});
