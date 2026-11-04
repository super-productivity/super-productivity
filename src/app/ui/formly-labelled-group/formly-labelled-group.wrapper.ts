import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FieldWrapper } from '@ngx-formly/core';

/**
 * Gives a field group a visible label and names it for screen readers, e.g. a
 * row of weekday chips. Use with `wrappers: ['labelled-group']` and
 * `props.label` on the group.
 */
@Component({
  selector: 'formly-labelled-group',
  standalone: true,
  template: `
    <div
      class="labelled-group"
      role="group"
      [attr.aria-labelledby]="id + '-group-label'"
    >
      <div
        class="labelled-group-label"
        [id]="id + '-group-label'"
      >
        {{ props.label }}
      </div>
      <ng-container #fieldComponent></ng-container>
    </div>
  `,
  styles: `
    .labelled-group-label {
      margin-bottom: var(--s);
      color: var(--text-color-muted);
      font-size: var(--font-size-sm);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyLabelledGroupWrapperComponent extends FieldWrapper {}
