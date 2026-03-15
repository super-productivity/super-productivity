import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { stringToMs } from '../string-to-ms.pipe';
import { InputDurationDirective } from '../input-duration.directive';
import { MatInput } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'input-duration-formly',
  templateUrl: './input-duration-formly.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    InputDurationDirective,
    MatInput,
    FormsModule,
    FormlyModule,
    ReactiveFormsModule,
  ],
})
export class InputDurationFormlyComponent
  extends FieldType<FormlyFieldConfig>
  implements OnDestroy
{
  private _timeout?: number;

  readonly input = viewChild.required('inputEl', { read: ElementRef });

  // @ViewChild(MatInput, {static: true}) formFieldControl?: MatInput;
  onInputValueChange(ev: Event): void {
    const val = (ev.target as HTMLInputElement).value;
    // Log.log('formly onInputValueChange', val);
    // this.formControl.setValue(val);
    this._updateValue(val);
  }

  override ngOnDestroy(): void {
    if (this._timeout) {
      window.clearTimeout(this._timeout);
    }
  }

  private _updateValue(val: string): void {
    this._timeout = window.setTimeout(() => {
      this.formControl.setValue(val ? stringToMs(val) : undefined);
    });
  }
}
