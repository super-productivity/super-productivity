import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  Input,
  input,
  output,
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
export class InlineInputComponent implements AfterViewInit {
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
    // Pending edits belong only to the editing session that just ended.
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
