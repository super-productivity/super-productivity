import { IS_ELECTRON } from '../app.constants';

/**
 * Workaround for Electron focus bug after native dialogs.
 * When native confirm() or alert() dialogs are shown and closed in Electron,
 * input elements lose focus and become unresponsive.
 *
 * See: https://github.com/electron/electron/issues/19977
 * See: https://github.com/electron/electron/issues/20821
 */
const restoreFocusAfterNativeDialog = (
  previouslyFocusedElement: HTMLElement | null,
): void => {
  if (IS_ELECTRON) {
    setTimeout(() => {
      window.blur();
      window.focus();

      // Restore focus to the previously focused element
      if (
        previouslyFocusedElement &&
        typeof previouslyFocusedElement.focus === 'function'
      ) {
        previouslyFocusedElement.focus();
      }
    }, 0);
  }
};

/**
 * Wrapper around native confirm() that fixes Electron focus bug.
 * Use this instead of window.confirm() or confirm().
 */
export const confirmDialog = (message: string): boolean => {
  const previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const result = window.confirm(message);
  restoreFocusAfterNativeDialog(previouslyFocusedElement);
  return result;
};

/**
 * Wrapper around native alert() that fixes Electron focus bug.
 * Use this instead of window.alert() or alert().
 */
export const alertDialog = (message: string): void => {
  const previouslyFocusedElement = document.activeElement as HTMLElement | null;
  window.alert(message);
  restoreFocusAfterNativeDialog(previouslyFocusedElement);
};
