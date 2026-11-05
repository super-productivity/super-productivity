import { InputModality } from '@angular/cdk/a11y';
import { MatBottomSheetConfig } from '@angular/material/bottom-sheet';

/**
 * Config for the bottom sheet that hosts the right panel on xs screens.
 *
 * `openModality` is the input that opened the sheet. Focus is handed back to
 * the opener on close only for keyboard users: after a tap it just leaves a
 * focus ring on e.g. the bottom-nav button, which then reads like a second
 * active nav item.
 */
export const getBottomPanelSheetConfig = (
  openModality: InputModality,
): MatBottomSheetConfig => ({
  hasBackdrop: true,
  closeOnNavigation: false,
  panelClass: 'bottom-panel-sheet',
  // Default 'first-tabbable' otherwise focuses the tag-edit
  // input, which on touch makes mat-autocomplete pop open
  // immediately on every task open in portrait.
  autoFocus: false,
  restoreFocus: openModality === 'keyboard',
});
