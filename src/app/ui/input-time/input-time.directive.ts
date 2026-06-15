import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  Renderer2,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { toPaddedClockStr } from '../../util/to-padded-clock-str';

/**
 * Value accessor for a native `<input type="time">` that keeps the bound model
 * value as a canonical zero-padded `HH:mm` string.
 *
 * The native control renders 12h/24h based on the browser/OS locale, but it
 * only *displays* zero-padded values — so a legacy config holding `9:00` would
 * show blank without this. On write we pad for display; on input we normalize
 * back to `HH:mm` (dropping any stray seconds), so the model never drifts from
 * canonical `HH:mm` regardless of how the value was entered.
 *
 * We intentionally do NOT re-emit the padded value on write: a legacy `9:00`
 * displays as `09:00` but stays `9:00` in the model until the user actually
 * edits it, so merely opening a settings page never dirties the form or writes
 * a spurious sync op.
 */
@Directive({
  selector: 'input[type=time][inputTime]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputTimeDirective),
      multi: true,
    },
  ],
})
export class InputTimeDirective implements ControlValueAccessor {
  private _elementRef = inject(ElementRef);
  private _renderer = inject(Renderer2);

  private _onChange: (value: string) => void = () => {};
  private _onTouched: () => void = () => {};

  @HostListener('input', ['$event.target.value'])
  onInput(value: string): void {
    this._onChange(toPaddedClockStr(value));
  }

  @HostListener('blur')
  onBlur(): void {
    this._onTouched();
  }

  writeValue(value: string | null): void {
    this._renderer.setProperty(
      this._elementRef.nativeElement,
      'value',
      toPaddedClockStr(value),
    );
  }

  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._renderer.setProperty(this._elementRef.nativeElement, 'disabled', isDisabled);
  }
}
