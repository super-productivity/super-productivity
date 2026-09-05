import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BodyClass } from '../../app.constants';

@Component({ selector: 'keyboard-contract-dialog', template: '<p>dialog</p>' })
class KeyboardContractDialogComponent {}

/**
 * The rendered half of #9779's split: IosKeyboardService writes the keyboard
 * variables on the CDK overlay container instead of `<html>`, which only holds
 * up if the rules that consume them sit inside that container and inherit
 * them. The service spec pins where the values are written; this pins that
 * writing them there still produces the layout the stylesheet promises.
 *
 * Uses a real MatDialog and the real injected OverlayContainer — the same
 * element the service targets — against the real global stylesheet (karma
 * builds `src/styles.scss` into the test bundle). It therefore fails if a
 * selector, a variable name, or CDK's overlay structure moves.
 */
describe('iOS keyboard CSS contract', () => {
  const VIEWPORT_HEIGHT_PX = 500;
  const SAFE_AREA_TOP_PX = 44;
  const SAFE_AREA_BOTTOM_PX = 34;
  const KEYBOARD_OVERLAY_OFFSET_PX = 300;

  let overlayContainer: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideNoopAnimations()] });
    document.body.classList.add(
      BodyClass.isNativeMobile,
      BodyClass.isIOS,
      BodyClass.isKeyboardVisible,
    );
    overlayContainer = TestBed.inject(OverlayContainer).getContainerElement();
    // Insets come from capacitor-plugin-safe-area on the device; scoping them to
    // the overlay layer keeps the expected numbers independent of the runner.
    overlayContainer.style.setProperty('--safe-area-top', `${SAFE_AREA_TOP_PX}px`);
    overlayContainer.style.setProperty('--safe-area-bottom', `${SAFE_AREA_BOTTOM_PX}px`);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.tick();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    document.body.classList.remove(
      BodyClass.isNativeMobile,
      BodyClass.isIOS,
      BodyClass.isKeyboardVisible,
    );
  });

  const openDialog = (): { pane: HTMLElement; wrapper: HTMLElement } => {
    TestBed.inject(MatDialog).open(KeyboardContractDialogComponent);
    TestBed.tick();
    const pane = overlayContainer.querySelector<HTMLElement>('.mat-mdc-dialog-panel');
    const wrapper = overlayContainer.querySelector<HTMLElement>(
      '.cdk-global-overlay-wrapper',
    );
    if (!pane || !wrapper) {
      throw new Error('CDK no longer nests the dialog panel in the overlay container');
    }
    return { pane, wrapper };
  };

  /** What IosKeyboardService writes on every viewport change. */
  const publishViewportHeight = (px: number): void =>
    overlayContainer.style.setProperty('--visual-viewport-height', `${px}px`);

  it('sizes a dialog panel from the overlay container variable', () => {
    publishViewportHeight(VIEWPORT_HEIGHT_PX);

    expect(getComputedStyle(openDialog().pane).maxHeight).toBe(
      `${VIEWPORT_HEIGHT_PX - SAFE_AREA_TOP_PX - SAFE_AREA_BOTTOM_PX}px`,
    );
  });

  it('falls back to the full window when nothing wrote the variable', () => {
    expect(getComputedStyle(openDialog().pane).maxHeight).toBe(
      `${window.innerHeight - SAFE_AREA_TOP_PX - SAFE_AREA_BOTTOM_PX}px`,
    );
  });

  // Also on the container: the add-task bar, the one consumer outside the
  // overlay layer, binds its own copy on its host (see AddTaskBarComponent).
  it('reserves keyboard space in the overlay wrapper from the container variable', () => {
    overlayContainer.style.setProperty(
      '--keyboard-overlay-offset',
      `${KEYBOARD_OVERLAY_OFFSET_PX}px`,
    );

    expect(getComputedStyle(openDialog().wrapper).paddingBottom).toBe(
      `${SAFE_AREA_BOTTOM_PX + KEYBOARD_OVERLAY_OFFSET_PX}px`,
    );
  });

  // Why app-shell code takes the height from IosKeyboardService.shellHeight
  // instead of this variable: outside the overlay layer it is still the 100vh
  // default from _css-variables.scss.
  it('does not reach elements outside the overlay container', () => {
    publishViewportHeight(VIEWPORT_HEIGHT_PX);
    const outside = document.createElement('div');
    outside.style.setProperty('height', 'var(--visual-viewport-height)');
    document.body.appendChild(outside);

    try {
      expect(getComputedStyle(outside).height).toBe(`${window.innerHeight}px`);
    } finally {
      outside.remove();
    }
  });
});
