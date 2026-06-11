import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatInput } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { InputTimeDirective } from '../input-time.directive';

/**
 * Formly `time` field type: a native `<input type="time">` that respects the
 * browser/OS locale's 12h/24h preference while storing a canonical `HH:mm`
 * string (see {@link InputTimeDirective}).
 */
@Component({
  selector: 'input-time-formly',
  templateUrl: './input-time-formly.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InputTimeDirective, MatInput, FormsModule, FormlyModule, ReactiveFormsModule],
})
export class InputTimeFormlyComponent extends FieldType<FormlyFieldConfig> {}
