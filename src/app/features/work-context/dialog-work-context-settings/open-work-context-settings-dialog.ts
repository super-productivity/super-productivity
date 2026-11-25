import type { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import type {
  DialogWorkContextSettingsComponent,
  WorkContextSettingsDialogData,
} from './dialog-work-context-settings.component';
import type { SnackService } from '../../../core/snack/snack.service';
import type { Project } from '../../project/project.model';
import type { Tag } from '../../tag/tag.model';
import { Log } from '../../../core/log';
import { T } from '../../../t.const';

export const WORK_CONTEXT_SETTINGS_DIALOG_CONFIG: MatDialogConfig<WorkContextSettingsDialogData> =
  {
    restoreFocus: true,
    backdropClass: 'cdk-overlay-transparent-backdrop',
    width: '600px',
    maxWidth: '95vw',
  };

export const openWorkContextSettingsDialog = async (
  matDialog: MatDialog,
  data: WorkContextSettingsDialogData,
): Promise<MatDialogRef<DialogWorkContextSettingsComponent>> => {
  const { DialogWorkContextSettingsComponent } =
    await import('./dialog-work-context-settings.component');

  return matDialog.open(DialogWorkContextSettingsComponent, {
    ...WORK_CONTEXT_SETTINGS_DIALOG_CONFIG,
    data,
  });
};

export const openWorkContextSettingsWithErrorHandling = async (
  matDialog: MatDialog,
  snackService: SnackService,
  options: {
    contextId: string;
    isProject: boolean;
    loadEntity: () => Promise<Project | Tag | undefined>;
  },
): Promise<void> => {
  try {
    const entity = await options.loadEntity();
    if (!entity) {
      throw new Error(`Unable to find work context ${options.contextId}`);
    }

    await openWorkContextSettingsDialog(matDialog, {
      isProject: options.isProject,
      entity,
    });
  } catch (err) {
    snackService.open({
      msg: T.GLOBAL_SNACK.OPEN_SETTINGS_ERROR,
      type: 'ERROR',
    });
    Log.err(err);
  }
};
