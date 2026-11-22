import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  input,
  OnInit,
  Renderer2,
} from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { StringToMsPipe } from './string-to-ms.pipe';
import { MsToStringPipe } from './ms-to-string.pipe';
import { TranslateService } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { processDurationInput } from './duration-input.util';

@Directive({
  selector: 'input[inputDuration]',
  providers: [
    StringToMsPipe,
    MsToStringPipe,
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputDurationDirective),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => InputDurationDirective),
      multi: true,
    },
  ],
  standalone: true,
})
export class InputDurationDirective implements ControlValueAccessor, Validator, OnInit {
  private _elementRef = inject(ElementRef);
  private _renderer = inject(Renderer2);
  private _stringToMs = inject(StringToMsPipe);
  private _msToString = inject(MsToStringPipe);
  private _translateService = inject(TranslateService);

  // Input signals with defaults
  readonly isAllowSeconds = input<boolean>(false);
  readonly isValidate = input<boolean>(true);
  readonly isShowZeroVal = input<boolean>(true);
  readonly defaultValue = input<string>('0m');

  // Internal state
  private _previousMsValue: number | null = null;
  private _msValue: number | null = null;
  private _disabled = false;

  // Form control callbacks
  private _onChange: (value: number | null) => void = () => {};
  private _onTouched: () => void = () => {};

  // Validator related properties
  private _validator: ((c: AbstractControl) => ValidationErrors | null) | null = null;
  private _validatorOnChange: () => void = () => {};

  @HostListener('input', ['$event.target.value'])
  onInput(value: string): void {
    if (this._disabled) return;
    this._processInput(value);
    this._onTouched();
  }

  @HostListener('blur')
  onBlur(): void {
    this._onTouched();
    this._formatDisplayValue();
  }

  ngOnInit(): void {
    this._formatDisplayValue();
  }

  writeValue(value: number | null): void {
    this._msValue = value;
    this._previousMsValue = value;
    this._formatDisplayValue();
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this._validatorOnChange = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled = isDisabled;
    this._renderer.setProperty(this._elementRef.nativeElement, 'disabled', isDisabled);
  }

  validate(control: AbstractControl): ValidationErrors | null {
    // First check if validation is enabled
    if (!this.isValidate()) {
      return null;
    }

    // Apply external validator if available
    // if (this._validator) {
    //   Log.log(this._validator(control), this._validator);
    //   return this._validator(control);
    // }

    // Apply built-in validation
    const value = control.value;

    // For duration fields, we only validate that the value is a valid number
    // 0 is a valid duration (0 minutes, 0 hours, etc.)
    if (value === null || value === undefined || Number.isNaN(value)) {
      return {
        duration: {
          invalid: true,
          message: this._translateService.instant(T.V.E_DURATION),
        },
      };
    }

    return null;
  }

  private _processInput(strVal: string): void {
    const result = processDurationInput(
      strVal,
      this.isAllowSeconds(),
      this._previousMsValue,
    );

    if (!result.shouldUpdate) {
      return;
    }

    // Update internal state and notify form control
    this._msValue = result.milliseconds;
    if (!this._previousMsValue || this._previousMsValue !== this._msValue) {
      this._onChange(result.milliseconds);
    }
    this._previousMsValue = this._msValue;
  }

  private _strToMs(str: string): number {
    return this._stringToMs.transform(str);
  }

  private _msToStr(ms: number): string {
    return this._msToString.transform(ms, this.isAllowSeconds(), true);
  }

  private _formatDisplayValue(): void {
    const inputElement = this._elementRef.nativeElement;

    if (this._msValue === null || this._msValue === undefined) {
      this._renderer.setProperty(inputElement, 'value', '');
      return;
    }

    if (this._msValue === 0 && !this.isShowZeroVal()) {
      this._renderer.setProperty(inputElement, 'value', '');
      return;
    }

    // Convert milliseconds back to string format for display
    let formattedValue = this._msToStr(this._msValue);

    // Use default value for zero if no formatted value
    if (!formattedValue && this._msValue === 0) {
      formattedValue = this.defaultValue();
    }

    this._renderer.setProperty(inputElement, 'value', formattedValue || '');
  }
}
