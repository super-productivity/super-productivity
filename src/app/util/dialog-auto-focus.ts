import { AutoFocusTarget, MatDialogConfig } from '@angular/material/dialog';
import { isTouchActive } from './input-intent';

/**
 * Opt-in for dialogs whose first step is typing (create/add something by
 * name, prompts that only ask for text): focus the first field on every
 * device, which raises the on-screen keyboard on touch.
 *
 * Pass it as `autoFocus` when opening the dialog. Any explicit `autoFocus`
 * wins over the default below; this constant only names the intent.
 */
export const DIALOG_AUTO_FOCUS_TYPING: AutoFocusTarget = 'first-tabbable';

/**
 * Initial focus for a dialog opened without an explicit `autoFocus`.
 *
 * - Touch input: focus the dialog container. Focus still moves into the
 *   dialog (screen readers announce it, a hardware keyboard can Tab on), but
 *   no text field gets focus, so the on-screen keyboard does not cover the
 *   dialog the user just opened.
 * - Otherwise: Material's default, the first tabbable element.
 *
 * Read at open time, so a hybrid device follows its current input
 * (see InputIntentService).
 */
export const getDefaultDialogAutoFocus = (
  isTouch: () => boolean = isTouchActive,
): AutoFocusTarget => (isTouch() ? 'dialog' : 'first-tabbable');

/**
 * Value for `MAT_DIALOG_DEFAULT_OPTIONS`. MatDialog uses the provided object
 * instead of `new MatDialogConfig()` (not merged with it), so it has to carry
 * all of Material's defaults (role, restoreFocus, ...). `autoFocus` is a getter
 * because MatDialog spreads the defaults into each dialog's config on open.
 */
export const createDialogDefaultOptions = (
  isTouch: () => boolean = isTouchActive,
): MatDialogConfig => {
  const options: MatDialogConfig = { ...new MatDialogConfig() };
  Object.defineProperty(options, 'autoFocus', {
    enumerable: true,
    get: (): AutoFocusTarget => getDefaultDialogAutoFocus(isTouch),
  });
  return options;
};
