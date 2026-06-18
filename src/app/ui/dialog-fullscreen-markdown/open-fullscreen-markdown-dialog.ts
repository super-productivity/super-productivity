import { Location } from '@angular/common';
import {
  MatDialog,
  MatDialogConfig,
  MatDialogRef,
  MatDialogState,
} from '@angular/material/dialog';
import { DialogFullscreenMarkdownComponent } from './dialog-fullscreen-markdown.component';

type FullscreenMarkdownData = { content: string; taskId?: string };

const FULLSCREEN_MARKDOWN_DIALOG_CONFIG: MatDialogConfig = {
  minWidth: '100vw',
  height: '100vh',
  restoreFocus: true,
  autoFocus: 'textarea',
};

/**
 * Open the fullscreen markdown editor so an in-flight edit survives a
 * navigation.
 *
 * MatDialog's default `closeOnNavigation` maps to the overlay's
 * `disposeOnNavigation`, which on a Location change (popstate/hashchange — the
 * Android back button, or the involuntary route change a window resize fires
 * when it crosses the mobile layout breakpoint) DISPOSES the overlay with no
 * result, so `afterClosed` emits `undefined` and the edit is silently dropped
 * (#8434). This helper opts out of it and instead closes through the dialog's
 * save path on the same Location signal, so the content is routed back through
 * `afterClosed` and the caller persists it. The listener self-cleans when the
 * dialog closes.
 *
 * `closeOnNavigation: false` is owned here and is the reason the helper exists —
 * it is not overridable by callers. Callers keep their own `afterClosed()`
 * subscription for persistence.
 *
 * NOTE: `DialogAddNoteComponent` (a subclass) is intentionally NOT routed
 * through this helper: it drafts to sessionStorage (so it loses no data) and its
 * `close()` calls `window.history.back()`, which here would re-enter
 * (back → popstate → close() → back …).
 */
export const openFullscreenMarkdownDialog = (
  matDialog: MatDialog,
  location: Location,
  data: FullscreenMarkdownData,
): MatDialogRef<DialogFullscreenMarkdownComponent> => {
  const dialogRef = matDialog.open<DialogFullscreenMarkdownComponent>(
    DialogFullscreenMarkdownComponent,
    { ...FULLSCREEN_MARKDOWN_DIALOG_CONFIG, closeOnNavigation: false, data },
  );

  const locationSub = location.subscribe(() => {
    // A breakpoint-crossing resize can emit more than one popstate; only act
    // while the dialog is still open so we don't re-run its exit animation
    // (MatDialogRef.close() is not idempotent). The guard runs synchronously,
    // so the component instance is guaranteed present while OPEN.
    if (dialogRef.getState() === MatDialogState.OPEN) {
      dialogRef.componentInstance.close();
    }
  });
  dialogRef.afterClosed().subscribe(() => locationSub.unsubscribe());

  return dialogRef;
};
