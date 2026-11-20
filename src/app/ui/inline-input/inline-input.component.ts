import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  Input,
  input,
  OnChanges,
  output,
  SimpleChanges,
  viewChild,
} from '@angular/core';
import { InputDurationDirective } from '../duration/input-duration.directive';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'inline-input',
  templateUrl: './inline-input.component.html',
  styleUrls: ['./inline-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InputDurationDirective, FormsModule],
})
export class InlineInputComponent implements AfterViewInit, OnChanges {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() type: 'text' | 'duration' | 'time' = 'text';
  readonly value = input<string | number>();
  readonly displayValue = input<string>();
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  @Input() newValue?: string | number;

  readonly changed = output<string | number>();
  readonly inputEl = viewChild<ElementRef>('inputEl');
  readonly inputElDuration = viewChild<ElementRef>('inputElDuration');

  @HostBinding('class.isFocused') isFocused: boolean = false;

  activeInputEl?: HTMLInputElement;

  constructor() {}

  ngOnChanges(changes: SimpleChanges<InlineInputComponent>): void {
    // ngModel writes a new outside value into the field, replacing the typed one
    // (or the value matches it, so there is nothing to save). Drop the pending
    // edit so blur cannot save a value the field no longer shows.
    if (changes.value && !changes.value.firstChange) {
      this.newValue = undefined;
    }
  }

  ngAfterViewInit(): void {
    this.activeInputEl =
      this.type === 'duration'
        ? (this.inputElDuration() as ElementRef).nativeElement
        : (this.inputEl() as ElementRef).nativeElement;
  }

  focusInput(): void {
    this.activeInputEl =
      this.type === 'duration'
        ? (this.inputElDuration() as ElementRef).nativeElement
        : (this.inputEl() as ElementRef).nativeElement;

    this.isFocused = true;
    (this.activeInputEl as HTMLElement).focus();
    if (this.type === 'text' || this.type === 'duration') {
      this.activeInputEl?.select();
    }
  }

  blur(): void {
    this.isFocused = false;

    if (
      (this.newValue || this.newValue === '' || this.newValue === 0) &&
      this.newValue !== this.value()
    ) {
      this.changed.emit(this.newValue);
    }
    // A pending edit belongs only to the editing session that just ended. When
    // the parent shows an unchanged value after the save (the planner's
    // remaining time can stay at 0), ngOnChanges never drops it, and a later
    // focus and blur without typing would save it again.
    this.newValue = undefined;
  }

  onChange(v: string | number): void {
    this.newValue = v;
  }

  keypressHandler(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      this.newValue = undefined;
      (this.activeInputEl as HTMLElement).blur();
    }

    if (ev.key === 'Enter') {
      (this.activeInputEl as HTMLElement).blur();
    }
  }
}
