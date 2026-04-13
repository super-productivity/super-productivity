import { DOCUMENT } from '@angular/common';
import { inject, Injectable, NgZone, signal } from '@angular/core';
import { deviceType } from 'detect-it';
import { BodyClass } from '../../app.constants';
import { IS_TOUCH_PRIMARY } from '../../util/is-mouse-primary';

export type InputIntent = 'mouse' | 'touch';

/**
 * Internal writable signal — read by isTouchActive() in src/app/util/input-intent.ts.
 * Only mutated by InputIntentService. Do not write from outside this module.
 */
export const _inputIntentSignal = signal<InputIntent>('mouse');

/**
 * Tracks the current input method (mouse vs touch) on hybrid devices
 * via Pointer Events API. On non-hybrid devices, does nothing.
 *
 * Toggles the existing body classes (isTouchPrimary/isMousePrimary)
 * dynamically so that all existing SCSS rules work without changes.
 */
@Injectable({ providedIn: 'root' })
export class InputIntentService {
  private _document = inject(DOCUMENT);
  private _zone = inject(NgZone);

  readonly currentIntent = _inputIntentSignal.asReadonly();

  constructor() {
    if (deviceType === 'mouseOnly') {
      return;
    }

    // Use detect-it's primaryInput to set the initial intent. Many phones are classified
    // as 'hybrid' by detect-it (they expose both touch and pointer APIs), yet their
    // primaryInput is still 'touch'. Defaulting to 'mouse' would mean the very first
    // drag on such a phone starts without the touch delay, because CDK reads
    // cdkDragStartDelay before the pointerdown handler can update the signal.
    this._setIntent(IS_TOUCH_PRIMARY ? 'touch' : 'mouse');

    this._zone.runOutsideAngular(() => {
      window.addEventListener(
        'pointermove',
        (e: PointerEvent) => {
          if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
            this._setIntent('mouse');
          }
        },
        { passive: true },
      );

      window.addEventListener(
        'pointerdown',
        (e: PointerEvent) => {
          if (e.pointerType === 'touch') {
            this._setIntent('touch');
          }
        },
        { passive: true },
      );
    });
  }

  private _setIntent(intent: InputIntent): void {
    if (_inputIntentSignal() === intent) {
      return;
    }
    _inputIntentSignal.set(intent);
    const body = this._document.body.classList;
    body.toggle(BodyClass.isTouchPrimary, intent === 'touch');
    body.toggle(BodyClass.isMousePrimary, intent === 'mouse');
  }
}
