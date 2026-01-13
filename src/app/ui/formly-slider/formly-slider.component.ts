import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';
import { MatSliderModule } from '@angular/material/slider';
import { ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldProps } from '@ngx-formly/material/form-field';

interface SliderProps extends FormlyFieldProps {
  displayWith?: (value: number) => string;
  discrete?: boolean;
  showTickMarks?: boolean;
  thumbLabel?: boolean;
}

@Component({
  selector: 'formly-field-mat-slider',
  standalone: true,
  imports: [MatSliderModule, ReactiveFormsModule],
  template: `
    <mat-slider
      [min]="props.min ?? 0"
      [max]="props.max ?? 100"
      [step]="props.step ?? 1"
      [discrete]="props.discrete ?? props.thumbLabel ?? true"
      [showTickMarks]="props.showTickMarks ?? false"
      [displayWith]="props.displayWith ?? defaultDisplayWith"
    >
      <input
        matSliderThumb
        [formControl]="formControl"
      />
    </mat-slider>
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
}
