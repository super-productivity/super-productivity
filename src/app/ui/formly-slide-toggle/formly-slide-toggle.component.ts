import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';

@Component({
  selector: 'formly-field-mat-slide-toggle',
  imports: [MatSlideToggleModule, MatInputModule, ReactiveFormsModule, MatIcon],
  template: `
    <mat-form-field>
      <mat-slide-toggle
        color="primary"
        [checked]="formControl.value"
        (change)="onChange($event)"
      >
        {{ props.label }}
        <input
          matInput
          hidden
        />
      </mat-slide-toggle>
      @if (props.icon) {
        <mat-icon>{{ props.icon }}</mat-icon>
      } @else if (props.svgIcon) {
        <mat-icon [svgIcon]="props.svgIcon"></mat-icon>
      }
      @if (props.description) {
        <mat-hint>{{ props.description }}</mat-hint>
      }
    </mat-form-field>
  `,
  styles: [
    `
      :host ::ng-deep .mat-mdc-form-field-infix {
        display: flex;
        justify-content: space-between;
      }
      mat-form-field {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlySlideToggleComponent extends FieldType<FormlyFieldConfig> {
  // complete this
  onChange(event: HTMLInputElement): void {
    const { checked } = event;
    this.formControl.setValue(checked);
  }
}
