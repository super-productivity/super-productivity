import { Directive, ElementRef, inject, OnDestroy, OnInit, output } from '@angular/core';
import { NgControl } from '@angular/forms';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';

@Directive({
  selector: 'input[matAutocomplete][spChipAutocompleteKeys]',
  standalone: true,
})
export class ChipAutocompleteKeysDirective implements OnInit, OnDestroy {
  readonly suggestionAccepted = output<string>();
  readonly textCommitted = output<string>();

  private readonly _el = inject(ElementRef<HTMLInputElement>);
  private readonly _trigger = inject(MatAutocompleteTrigger, { self: true });
  private readonly _control = inject(NgControl, { self: true, optional: true });

  ngOnInit(): void {
    this._el.nativeElement.addEventListener('keydown', this._onKeydown, true);
  }

  ngOnDestroy(): void {
    this._el.nativeElement.removeEventListener('keydown', this._onKeydown, true);
  }

  private readonly _onKeydown = (ev: KeyboardEvent): void => {
    const trigger = this._trigger;
    const autocomplete = trigger.autocomplete;
    if (!autocomplete?.isOpen || hasModifierKey(ev, 'altKey', 'ctrlKey', 'metaKey')) {
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
      const value = this._el.nativeElement.value.trim();
      this._clear();
      trigger.closePanel();
      if (value) {
        this.textCommitted.emit(value);
      }
    }
  };

  private _clear(): void {
    this._el.nativeElement.value = '';
    this._control?.control?.setValue(null);
  }
}
