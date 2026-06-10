import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FormlyModule } from '@ngx-formly/core';
import { InputColorPickerComponent } from '../../../ui/input-color-picker/input-color-picker.component';

@Component({
  selector: 'color-input',
  templateUrl: './color-input.component.html',
  styleUrls: ['./color-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormlyModule, ReactiveFormsModule, InputColorPickerComponent],
})
export class ColorInputComponent extends FieldType {
  onColorChange(color: string): void {
    this.formControl.setValue(color);
    this.formControl.markAsTouched();
    this.formControl.markAsDirty();
  }
}
