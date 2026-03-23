import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatInput } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { prepareKeyCode } from '../../../util/check-key-combo';

@Component({
  selector: 'keyboard-input',
  templateUrl: './keyboard-input.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatInput, FormsModule, ReactiveFormsModule, FormlyModule],
})
export class KeyboardInputComponent extends FieldType<FormlyFieldConfig> {
  // @ViewChild(MatInput, {static: true}) formFieldControl: MatInput;

  get type(): string {
    return this.to.type || 'text';
  }

  onKeyDown(ev: KeyboardEvent): void {
    // ! Use ev.code to support multilanguage layouts
    const keyCode = ev.code;

    // Tab key should continue to behave normally
    if (keyCode === 'Tab') return;

    ev.preventDefault();
    ev.stopPropagation();

    // Focus out on escape
    if (keyCode === 'Escape') {
      this.formControl.setValue(null);
      if (ev.target instanceof HTMLElement) ev.target.blur();
    } else if (
      [
        'ShiftLeft',
        'ShiftRight',
        'ControlLeft',
        'ControlRight',
        'AltLeft',
        'AltRight',
      ].includes(keyCode)
    ) {
      // Don't update if event is for ctrl alt or shift down itself
      return;
    } else {
      let val = '';
      if (ev.ctrlKey) val += 'Ctrl+';
      if (ev.altKey) val += 'Alt+';
      if (ev.shiftKey) val += 'Shift+';
      if (ev.metaKey) val += 'Meta+';

      const keyName = prepareKeyCode(keyCode);

      if (keyName === 'Meta') {
        // Fail safe for MacOsX crashing bug
      } else {
        this.formControl.setValue(val + keyName);
      }
    }
  }
}
