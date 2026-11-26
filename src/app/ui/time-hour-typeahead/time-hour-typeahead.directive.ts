import { Directive, ElementRef, HostListener, inject } from '@angular/core';

// Chromium clears a time field's typed digits after this pause
const TYPEAHEAD_TIMEOUT_MS = 1000;
const TIME_RE = /^(\d{2}):(\d{2})(.*)$/;

interface TypedDigit {
  digit: number;
  isFresh: boolean;
  valueBefore: string;
}

/**
 * Lets hours 20-23 be typed into a native time input shown in 12h format.
 *
 * Chromium's 12h hour field accepts 13-19 after a "1", but jumps to the
 * minutes right after a "2" (20 > 12), so "2215" ends up as 02:21 (#11252).
 * When the digit after a fresh "2" lands in the minutes, this moves it back
 * into the hour. 24h fields take the digit natively and are left alone.
 */
@Directive({
  selector: 'input[type=time][spTimeHourTypeahead]',
  standalone: true,
})
export class TimeHourTypeaheadDirective {
  private readonly _el = inject(ElementRef<HTMLInputElement>);
  private _lastDigitTs = -Infinity;
  private _typed: TypedDigit | null = null;
  private _isHourTwoTyped = false;

  @HostListener('keydown', ['$event'])
  onKeyDown(ev: KeyboardEvent): void {
    if (!/^[0-9]$/.test(ev.key)) {
      this._typed = null;
      this._isHourTwoTyped = false;
      return;
    }
    this._typed = {
      digit: +ev.key,
      isFresh: ev.timeStamp - this._lastDigitTs > TYPEAHEAD_TIMEOUT_MS,
      valueBefore: this._el.nativeElement.value,
    };
    this._lastDigitTs = ev.timeStamp;
  }

  @HostListener('input')
  onInput(): void {
    const typed = this._typed;
    const isHourTwoTyped = this._isHourTwoTyped;
    // cleared first so the input event dispatched below is ignored
    this._typed = null;
    this._isHourTwoTyped = false;
    if (!typed) return;

    const el = this._el.nativeElement;
    const before = TIME_RE.exec(typed.valueBefore);
    const after = TIME_RE.exec(el.value);
    if (!before || !after) return;

    const isLandedInMinutes = after[1] === before[1] && +after[2] === typed.digit;
    if (isHourTwoTyped && !typed.isFresh && typed.digit <= 3 && isLandedInMinutes) {
      el.value = `${20 + typed.digit}:${before[2]}${before[3]}`;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    this._isHourTwoTyped =
      typed.digit === 2 &&
      typed.isFresh &&
      after[2] === before[2] &&
      Number(after[1]) % 12 === 2;
  }
}
