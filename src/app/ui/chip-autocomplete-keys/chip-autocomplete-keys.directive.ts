import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  OnInit,
  output,
  Renderer2,
} from '@angular/core';
import { NgControl } from '@angular/forms';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';

const IME_PROCESS_KEY_CODE = 229;

@Directive({
  selector: 'input[matAutocomplete][spChipAutocompleteKeys]',
  standalone: true,
})
export class ChipAutocompleteKeysDirective implements OnInit {
  readonly suggestionAccepted = output<string>();
  readonly textCommitted = output<string>();

  private readonly _el = inject(ElementRef<HTMLInputElement>);
  private readonly _renderer = inject(Renderer2);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _trigger = inject(MatAutocompleteTrigger, { self: true });
  private readonly _control = inject(NgControl, { self: true, optional: true });

  ngOnInit(): void {
    const unlisten = this._renderer.listen(
      this._el.nativeElement,
      'keydown',
      this._onKeydown,
      { capture: true },
    );
    this._destroyRef.onDestroy(unlisten);
  }

  private readonly _onKeydown = (ev: KeyboardEvent): void => {
    const trigger = this._trigger;
    const autocomplete = trigger.autocomplete;
    const typed = this._el.nativeElement.value.trim();
    if (
      !autocomplete?.isOpen ||
      !typed ||
      ev.isComposing ||
      ev.keyCode === IME_PROCESS_KEY_CODE ||
      hasModifierKey(ev, 'altKey', 'ctrlKey', 'metaKey')
    ) {
      return;
    }

    if (ev.key === 'Tab') {
      if (ev.shiftKey) {
        this._clear();
        trigger.closePanel();
        return;
      }
      const option = trigger.activeOption ?? autocomplete.options.first;
      if (!option) {
        return;
      }
      ev.preventDefault();
      this._clear();
      trigger.closePanel();
      this.suggestionAccepted.emit(option.value);
    } else if (ev.key === 'Enter' && !trigger.activeOption) {
      ev.preventDefault();
      this._clear();
      trigger.closePanel();
      this.textCommitted.emit(typed);
    }
  };

  private _clear(): void {
    this._el.nativeElement.value = '';
    this._control?.control?.setValue(null);
  }
}
