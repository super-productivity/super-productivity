import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';

/**
 * A boolean field shown as a small chip, for rows of short choices such as
 * weekdays. It is a native checkbox underneath, so its FormControl binding and
 * keyboard use (Tab, Space) are the browser's. `props.label` names it for
 * screen readers; `props.shortLabel`, when set, is the text on the chip.
 */
@Component({
  selector: 'formly-chip-checkbox',
  standalone: true,
  imports: [ReactiveFormsModule, FormlyModule],
  template: `
    <label class="chip-checkbox">
      <input
        type="checkbox"
        class="cdk-visually-hidden"
        [id]="id"
        [formControl]="formControl"
        [formlyAttributes]="field"
        [attr.aria-label]="props.label"
      />
      <span
        class="chip"
        aria-hidden="true"
        ><span class="chip-text">{{ props['shortLabel'] || props.label }}</span></span
      >
    </label>
  `,
  styleUrl: './formly-chip-checkbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyChipCheckboxComponent extends FieldType<FieldTypeConfig> {}
