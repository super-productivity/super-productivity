import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FlexibleConnectedPositionStrategy,
  OverlayContainer,
} from '@angular/cdk/overlay';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { patchCdkViewportForSafeArea } from './cdk-safe-area-viewport.util';
import { BodyClass } from '../../app.constants';

const SAFE_BOTTOM = 48;
const SAFE_TOP = 48;
const NAV_HEIGHT = 56;
const KEYBOARD_OVERLAY_OFFSET = 200;

/**
 * Mirrors the mobile bottom nav (#8792): a bar pinned to the viewport bottom
 * that reserves the bottom inset as padding, with a menu trigger in its button
 * row, i.e. a trigger whose bottom edge sits exactly at the top of the
 * reserved system-bar strip.
 */
@Component({
  selector: 'safe-area-menu-host',
  imports: [MatMenuModule],
  template: `
    <nav
      [style.position]="'fixed'"
      [style.left.px]="0"
      [style.right.px]="0"
      [style.bottom.px]="0"
      [style.height.px]="navHeight + safeBottom"
      [style.padding-bottom.px]="safeBottom"
      [style.box-sizing]="'border-box'"
    >
      <button
        [style.height.px]="navHeight"
        [matMenuTriggerFor]="panelsMenu"
      >
        panels
      </button>
    </nav>
    <mat-menu #panelsMenu="matMenu">
      @for (label of itemLabels; track label) {
        <button mat-menu-item>{{ label }}</button>
      }
    </mat-menu>
  `,
})
class SafeAreaMenuHostComponent {
  safeBottom = SAFE_BOTTOM;
  navHeight = NAV_HEIGHT;
  itemLabels = ['Project notes'];
  trigger = viewChild.required(MatMenuTrigger);
}

describe('patchCdkViewportForSafeArea', () => {
  const proto = FlexibleConnectedPositionStrategy.prototype as unknown as Record<
    string,
    unknown
  >;
  let originalMarginTop: unknown;
  let originalMarginBottom: unknown;

  const overlayContainerEl = (): HTMLElement =>
    TestBed.inject(OverlayContainer).getContainerElement();

  const openMenuAndMeasure = async (
    itemLabels?: string[],
  ): Promise<{
    panelBottom: number;
    triggerTop: number;
    safeAreaTopEdge: number;
  }> => {
    const fixture = TestBed.createComponent(SafeAreaMenuHostComponent);
    if (itemLabels) {
      fixture.componentInstance.itemLabels = itemLabels;
    }
    fixture.detectChanges();
    const triggerEl = fixture.nativeElement.querySelector('button') as HTMLElement;
    const triggerTop = triggerEl.getBoundingClientRect().top;

    fixture.componentInstance.trigger().openMenu();
    fixture.detectChanges();
    await fixture.whenStable();

    const panel = document.querySelector('.mat-mdc-menu-panel') as HTMLElement;
    return {
      panelBottom: panel.getBoundingClientRect().bottom,
      triggerTop,
      safeAreaTopEdge: document.documentElement.clientHeight - SAFE_BOTTOM,
    };
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideNoopAnimations()] });
    originalMarginTop = proto['_getViewportMarginTop'];
    originalMarginBottom = proto['_getViewportMarginBottom'];
    patchCdkViewportForSafeArea(document, overlayContainerEl());
  });

  afterEach(() => {
    // The patch mutates a shared CDK prototype; leave it as we found it.
    proto['_getViewportMarginTop'] = originalMarginTop;
    proto['_getViewportMarginBottom'] = originalMarginBottom;
    proto['_spSafeAreaPatched'] = false;
    document.documentElement.style.removeProperty('--safe-area-bottom');
    document.documentElement.style.removeProperty('--safe-area-top');
    document.documentElement.style.removeProperty('--safe-area-inset-bottom');
    document.body.classList.remove(BodyClass.isIOS, BodyClass.isKeyboardVisible);
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  // Android WebView >= 140: Capacitor SystemBars passes the native insets
  // through instead of injecting the vars, so only env() carries the value.
  it('keeps a bottom-anchored menu out of the inset when it comes from env() only', async () => {
    document.documentElement.style.setProperty('--safe-area-bottom', `${SAFE_BOTTOM}px`);

    const { panelBottom, triggerTop, safeAreaTopEdge } = await openMenuAndMeasure();

    expect(panelBottom).toBeLessThanOrEqual(safeAreaTopEdge);
    // Exactly above the trigger: narrowing CDK's viewport rect instead of its
    // viewport margins shifts this down by the inset, whatever the geometry.
    expect(panelBottom).toBeCloseTo(triggerTop, 0);
  });

  // iOS (and the Android bands that do inject) feed --safe-area-inset-*.
  it('keeps a bottom-anchored menu out of the inset when it comes from the injected var', async () => {
    document.documentElement.style.setProperty(
      '--safe-area-inset-bottom',
      `${SAFE_BOTTOM}px`,
    );

    const { panelBottom, triggerTop, safeAreaTopEdge } = await openMenuAndMeasure();

    expect(panelBottom).toBeLessThanOrEqual(safeAreaTopEdge);
    expect(panelBottom).toBeCloseTo(triggerTop, 0);
  });

  // The reporter's device (#8792, Android 16): a status bar *and* a navigation
  // bar, so both insets are non-zero. Both came off `viewport.height`, so the
  // shipped code understated the bounding box's `bottom` by their sum and
  // pinned the panel's bottom edge there regardless of how tall the panel was,
  // which is why enabling a second menu entry did not move it out of the strip.
  it('places a two-item menu at its trigger, not lower, when both insets are set', async () => {
    document.documentElement.style.setProperty('--safe-area-top', `${SAFE_TOP}px`);
    document.documentElement.style.setProperty('--safe-area-bottom', `${SAFE_BOTTOM}px`);

    const twoItems = await openMenuAndMeasure(['Issue provider panel', 'Project notes']);
    const oneItem = await openMenuAndMeasure(['Project notes']);

    expect(twoItems.panelBottom).toBeLessThanOrEqual(twoItems.safeAreaTopEdge);
    expect(twoItems.panelBottom).toBeCloseTo(twoItems.triggerTop, 0);
    // Same bottom edge for both: the placement must not depend on panel height.
    expect(twoItems.panelBottom).toBeCloseTo(oneItem.panelBottom, 0);
  });

  // iOS with a keyboard that overlays the viewport: IosKeyboardService writes
  // the offset on the overlay container, never on <html> (#9779), and the
  // strategy has to read it from there.
  it('keeps a bottom-anchored menu above the iOS keyboard offset on the overlay container', async () => {
    document.documentElement.style.setProperty('--safe-area-bottom', `${SAFE_BOTTOM}px`);
    document.body.classList.add(BodyClass.isIOS, BodyClass.isKeyboardVisible);
    overlayContainerEl().style.setProperty(
      '--keyboard-overlay-offset',
      `${KEYBOARD_OVERLAY_OFFSET}px`,
    );

    const { panelBottom, safeAreaTopEdge } = await openMenuAndMeasure();

    // The menu is pushed to exactly the reserved edge (without the keyboard term
    // it lands at safeAreaTopEdge - navHeight).
    expect(panelBottom).toBeCloseTo(safeAreaTopEdge - KEYBOARD_OVERLAY_OFFSET, 0);
  });

  it('does not stack insets when applied more than once', async () => {
    document.documentElement.style.setProperty('--safe-area-bottom', `${SAFE_BOTTOM}px`);
    patchCdkViewportForSafeArea(document, overlayContainerEl());
    patchCdkViewportForSafeArea(document, overlayContainerEl());

    const { panelBottom, triggerTop } = await openMenuAndMeasure();

    expect(panelBottom).toBeCloseTo(triggerTop, 0);
  });
});
