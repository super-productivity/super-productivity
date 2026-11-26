import { checkKeyCombo } from './check-key-combo';
import { isInputElement } from './dom-element';

// Keys the menu itself uses to move and choose; a shortcut overrides them only
// with Ctrl, Alt or Meta held.
const MENU_NAVIGATION_KEYS = new Set([
  'Enter',
  ' ',
  'Escape',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

/**
 * Runs the item of the focused menu whose listed shortcut (its `.key-i` label)
 * matches `ev`, so a shortcut shown in an open menu does what the menu says.
 * Call it in the capture phase: the menu's own keydown handler otherwise uses
 * the letter for type-ahead and focuses the first item whose label starts with
 * it ("T" → "Toggle tags" instead of "Estimate [T]").
 *
 * @returns true if an item was activated (and the event stopped)
 */
export const handleMenuItemHotkey = (ev: KeyboardEvent): boolean => {
  const target = ev.target;
  if (
    !(target instanceof HTMLElement) ||
    isInputElement(target) ||
    ev.isComposing ||
    (MENU_NAVIGATION_KEYS.has(ev.key) && !ev.ctrlKey && !ev.altKey && !ev.metaKey)
  ) {
    return false;
  }
  // A menu opened by mouse leaves focus on <body>; the overlay then sends keys
  // to the topmost menu, which is the last panel in the overlay container.
  const panel =
    target.closest('.mat-mdc-menu-panel') ??
    Array.from(target.ownerDocument.querySelectorAll('.mat-mdc-menu-panel')).at(-1);
  if (!panel) {
    return false;
  }
  for (const keyLabel of panel.querySelectorAll<HTMLElement>(
    '.mat-mdc-menu-item .key-i',
  )) {
    const item = keyLabel.closest<HTMLElement>('.mat-mdc-menu-item')!;
    if (
      item.getAttribute('aria-disabled') !== 'true' &&
      checkKeyCombo(ev, keyLabel.textContent?.trim())
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      // A submenu trigger opens its submenu on click and focuses its first item.
      item.click();
      return true;
    }
  }
  return false;
};
