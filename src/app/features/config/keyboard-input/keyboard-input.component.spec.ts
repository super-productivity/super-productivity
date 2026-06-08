import { UntypedFormControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { KeyboardInputComponent } from './keyboard-input.component';

const createComponent = (initialValue: string | null): KeyboardInputComponent => {
  const component = new KeyboardInputComponent();
  component.field = {
    formControl: new UntypedFormControl(initialValue),
    props: {},
  } as FormlyFieldConfig;
  return component;
};

const createKeydown = (code: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, ...init });

describe('KeyboardInputComponent', () => {
  it('clears an existing shortcut with plain Backspace or Delete', () => {
    for (const code of ['Backspace', 'Delete']) {
      const component = createComponent('Meta+N');
      const ev = createKeydown(code);
      const preventDefaultSpy = spyOn(ev, 'preventDefault').and.callThrough();
      const stopPropagationSpy = spyOn(ev, 'stopPropagation').and.callThrough();

      component.onKeyDown(ev);

      expect(component.formControl.value).toBe(null);
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    }
  });

  it('keeps Backspace and Delete assignable when the shortcut is empty', () => {
    for (const code of ['Backspace', 'Delete']) {
      const component = createComponent(null);
      const ev = createKeydown(code);

      component.onKeyDown(ev);

      expect(component.formControl.value).toBe(code);
    }
  });

  it('keeps modified Backspace and Delete assignable over an existing shortcut', () => {
    const component = createComponent('Meta+N');

    component.onKeyDown(createKeydown('Backspace', { ctrlKey: true }));
    expect(component.formControl.value).toBe('Ctrl+Backspace');

    component.onKeyDown(createKeydown('Delete', { shiftKey: true }));
    expect(component.formControl.value).toBe('Shift+Delete');
  });
});
