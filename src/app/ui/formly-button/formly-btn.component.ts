import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { Log } from '../../core/log';

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  'then' in value &&
  typeof value.then === 'function';

@Component({
  selector: 'formly-btn',
  templateUrl: './formly-btn.component.html',
  styleUrl: './formly-btn.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormlyModule, MatButton, MatTooltip, TranslatePipe],
})
export class FormlyBtnComponent extends FieldType<FormlyFieldConfig> {
  onClick(): void {
    if (this.to.onClick) {
      const r = this.to.onClick(this.field, this.form, this.model);
      if (isPromiseLike(r)) {
        r.then((v) => {
          this.formControl.setValue(v);
          this.form.markAsDirty();
        }).catch((err) => {
          Log.err('FormlyBtnComponent onClick error', err);
        });
      } else {
        this.formControl.setValue(r);
        this.form.markAsDirty();
      }
    }
  }
}
