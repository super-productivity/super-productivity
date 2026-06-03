import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { GlobalConfigFormSectionKey } from '../global-config.model';
import { ProjectCfgFormKey } from '../../project/project.model';
import { T } from '../../../t.const';
import { exists } from '../../../util/exists';
import { adjustToLiveFormlyForm } from '../../../util/adjust-to-live-formly-form';
import { Log } from '../../../core/log';

@Component({
  selector: 'config-form',
  templateUrl: './config-form.component.html',
  styleUrls: ['./config-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReactiveFormsModule, FormlyModule],
})
export class ConfigFormComponent {
  T: typeof T = T;
  cfg = input.required<Record<string, unknown>>();
  formCfg = input.required<FormlyFieldConfig[]>();
  sectionKey = input<GlobalConfigFormSectionKey | ProjectCfgFormKey>();
  fields = computed(() => adjustToLiveFormlyForm(this.formCfg()));

  save = output<{
    sectionKey: GlobalConfigFormSectionKey | ProjectCfgFormKey;
    config: unknown;
  }>();
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {};

  updateCfg(cfg: Record<string, unknown>): void {
    if (!cfg) {
      throw new Error('No config for ' + this.sectionKey());
    }

    // Mark all fields as touched to show validation errors
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();

    if (this.form.valid) {
      this.save.emit({
        sectionKey: exists(this.sectionKey()),
        config: cfg,
      });
    } else {
      // Update validity to ensure error messages are shown
      this.form.updateValueAndValidity();
      Log.err('Form is invalid, not saving config:', this.form.errors);
    }
  }
}
