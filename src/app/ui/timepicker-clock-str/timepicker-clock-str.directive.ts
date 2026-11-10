import {
  Directive,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { MatTimepickerInput } from '@angular/material/timepicker';
import { toPaddedClockStr } from '../../util/to-padded-clock-str';

const toClockStr = (date: Date | null): string | null =>
  date && !isNaN(date.getTime())
    ? toPaddedClockStr(`${date.getHours()}:${date.getMinutes()}`)
    : null;

/**
 * Binds a MatTimepicker input to a canonical `HH:mm` string, the format the
 * native time inputs and the persisted models use. MatTimepicker itself only
 * deals in `Date`s and owns the element's value accessor, so this bridges
 * through its `value` model instead of forms.
 *
 * Emits `null` for an empty or unparseable entry.
 */
@Directive({
  selector: 'input[matTimepicker][spClockStr]',
  standalone: true,
})
export class TimepickerClockStrDirective {
  private readonly _timepickerInput = inject(MatTimepickerInput<Date>);
  private readonly _el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly _dateAdapter = inject<DateAdapter<Date>>(DateAdapter);
  private readonly _dateFormats = inject(MAT_DATE_FORMATS);

  readonly spClockStr = input<string | null | undefined>(null);
  readonly spClockStrChange = output<string | null>();

  private _lastClockStr: string | null = null;
  private _hasTypedSinceFocus = false;

  constructor() {
    effect(() => {
      const clockStr = toPaddedClockStr(this.spClockStr()) || null;
      if (clockStr === this._lastClockStr) return;
      this._lastClockStr = clockStr;
      const [h, m] = (clockStr ?? '').split(':');
      const date = clockStr ? new Date(2000, 0, 1, +h, +m) : null;
      untracked(() => this._timepickerInput.value.set(date));
      // MatTimepicker leaves the text alone while focused so it never rewrites
      // what the user types; the default time filled in on focus would stay
      // invisible until blur. Only before the user types: a saved earlier
      // value echoed back mid-typing ("18" saved, "183" typed) or after a
      // clear must not overwrite the text — blur shows the value either way.
      const el = this._el.nativeElement;
      if (el.ownerDocument.activeElement === el && !this._hasTypedSinceFocus) {
        el.value = date
          ? this._dateAdapter.format(date, this._dateFormats.display.timeInput)
          : '';
      }
    });

    this._timepickerInput.value.subscribe((date) => {
      const clockStr = toClockStr(date);
      if (clockStr === this._lastClockStr) return;
      this._lastClockStr = clockStr;
      this.spClockStrChange.emit(clockStr);
    });
  }

  @HostListener('focus')
  onFocus(): void {
    this._hasTypedSinceFocus = false;
  }

  @HostListener('input')
  onInput(): void {
    this._hasTypedSinceFocus = true;
  }

  /**
   * MatTimepicker only reformats valid values on blur, so unreadable text
   * ("25") would stay visible after the time was already cleared.
   */
  @HostListener('blur')
  onBlur(): void {
    if (this._lastClockStr === null) this._el.nativeElement.value = '';
  }
}
