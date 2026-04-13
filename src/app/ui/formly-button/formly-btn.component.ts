import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { Log } from '../../core/log';

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
      if (r && 'then' in r) {
        r.then((v) => {
          Log.log('update', v, this);
          this.formControl.setValue(v);
          this.form.markAsDirty();
        }).catch((err) => {
          Log.err('FormlyBtnComponent onClick error', err);
        });
      } else {
        this.formControl.setValue(r);
      }
    }
  }
}
