import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DEFAULT_PROJECT } from '../../project/project.const';
import { DialogWorkContextSettingsComponent } from './dialog-work-context-settings.component';
import {
  openWorkContextSettingsDialog,
  openWorkContextSettingsWithErrorHandling,
  WORK_CONTEXT_SETTINGS_DIALOG_CONFIG,
} from './open-work-context-settings-dialog';
import type { WorkContextSettingsDialogData } from './dialog-work-context-settings.component';
import { SnackService } from '../../../core/snack/snack.service';
import { Log } from '../../../core/log';
import { T } from '../../../t.const';

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

  it('reports a missing work context', async () => {
    const matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    const snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const logError = spyOn(Log, 'err');

    await openWorkContextSettingsWithErrorHandling(matDialog, snackService, {
      contextId: 'missing',
      isProject: true,
      loadEntity: () => Promise.resolve(undefined),
    });

    expect(matDialog.open).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledOnceWith({
      msg: T.GLOBAL_SNACK.OPEN_SETTINGS_ERROR,
      type: 'ERROR',
    });
    expect(logError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ message: 'Unable to find work context missing' }),
    );
  });

  it('reports dialog opening failures instead of rejecting', async () => {
    const matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    const snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const error = new Error('dialog open failed');
    matDialog.open.and.throwError(error);
    const logError = spyOn(Log, 'err');

    await expectAsync(
      openWorkContextSettingsWithErrorHandling(matDialog, snackService, {
        contextId: DEFAULT_PROJECT.id,
        isProject: true,
        loadEntity: () => Promise.resolve(DEFAULT_PROJECT),
      }),
    ).toBeResolved();

    expect(snackService.open).toHaveBeenCalledOnceWith({
      msg: T.GLOBAL_SNACK.OPEN_SETTINGS_ERROR,
      type: 'ERROR',
    });
    expect(logError).toHaveBeenCalledOnceWith(error);
  });
});
