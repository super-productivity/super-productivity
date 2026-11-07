import { MatDialog } from '@angular/material/dialog';
import { DIALOG_AUTO_FOCUS_TYPING } from '../../../util/dialog-auto-focus';

/** Opens the "Build your own plugin" dialog, loading it only when needed. */
export const openBuildPluginDialog = async (matDialog: MatDialog): Promise<void> => {
  const { DialogBuildPluginComponent } = await import('./dialog-build-plugin.component');
  matDialog.open(DialogBuildPluginComponent, {
    restoreFocus: true,
    autoFocus: DIALOG_AUTO_FOCUS_TYPING,
    width: '600px',
  });
};
