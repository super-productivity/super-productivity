import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';
import { MatSliderModule } from '@angular/material/slider';
import { ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldProps } from '@ngx-formly/material/form-field';
import { MatInputModule } from '@angular/material/input';

interface SliderProps extends FormlyFieldProps {
  displayWith?: (value: number) => string;
  discrete?: boolean;
  showTickMarks?: boolean;
  thumbLabel?: boolean;
}

@Component({
  selector: 'formly-field-mat-slider',
  standalone: true,
  imports: [MatSliderModule, ReactiveFormsModule, MatInputModule],
  template: `
    <mat-form-field>
      @if (props.label) {
        <mat-label>{{ props.label }}</mat-label>
      }
      <mat-slider
        [min]="props.min ?? 0"
        [max]="props.max ?? 100"
        [step]="props.step ?? 1"
        [discrete]="props.discrete ?? props.thumbLabel ?? true"
        [showTickMarks]="props.showTickMarks ?? false"
        [displayWith]="props.displayWith ?? defaultDisplayWith"
      >
        <input
          style="height: 100%"
          matSliderThumb
          matInput
          [value]="formControl.value"
          (change)="onChange($event)"
        />
      </mat-slider>
      @if (props.description) {
        <mat-hint>{{ props.description }}</mat-hint>
      }
    </mat-form-field>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      mat-slider {
        width: 100%;
      }
      mat-form-field {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlySliderComponent extends FieldType<FieldTypeConfig<SliderProps>> {
  defaultDisplayWith = (value: number): string => `${value}`;

  override defaultOptions = {
    props: {
      hideFieldUnderline: true,
      floatLabel: 'always' as const,
    },
  };

  onChange(event: Event): void {
    const value: number = Number((event.target as HTMLInputElement).value);
    this.formControl.setValue(value);
  }
}
