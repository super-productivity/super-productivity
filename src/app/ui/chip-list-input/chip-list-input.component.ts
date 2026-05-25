import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  input,
  OnDestroy,
  output,
  viewChild,
  HostAttributeToken,
  inject,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { Observable } from 'rxjs';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import {
  MatChipGrid,
  MatChipInput,
  MatChipInputEvent,
  MatChipRemove,
  MatChipRow,
} from '@angular/material/chips';
import { map, startWith } from 'rxjs/operators';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { T } from '../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AsyncPipe } from '@angular/common';
import { TagComponent } from '../../features/tag/tag/tag.component';

const DEFAULT_SEPARATOR_KEY_CODES: number[] = [ENTER, COMMA];

// Items render via <tag>, so non-tag callers get a colorless circle + title (graceful degradation).
interface Suggestion {
  id: string;
  title: string;

  [key: string]: unknown;
}

@Component({
  selector: 'chip-list-input',
  templateUrl: './chip-list-input.component.html',
  styleUrls: ['./chip-list-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormField,
    MatLabel,
    MatChipGrid,
    MatChipRow,
    MatIcon,
    MatChipRemove,
    MatTooltip,
    MatIconButton,
    FormsModule,
    MatAutocompleteTrigger,
    MatChipInput,
    ReactiveFormsModule,
    MatAutocomplete,
    MatOption,
    TranslatePipe,
    AsyncPipe,
    TagComponent,
  ],
})
export class ChipListInputComponent implements OnDestroy {
  autoFocus = inject(new HostAttributeToken('autoFocus'), { optional: true });

  // TODO maybe use new api
  // autoFocus = inject(new HostAttributeToken('autoFocus'));

  T: typeof T = T;

  readonly label = input<string>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() additionalActionIcon?: string;
  readonly additionalActionTooltip = input<string>();
  readonly additionalActionTooltipUnToggle = input<string>();
  readonly toggledItems = input<string[]>();

  readonly addItem = output<string>();
  readonly addNewItem = output<string>();
  readonly removeItem = output<string>();
  readonly additionalAction = output<string>();
  readonly ctrlEnterSubmit = output<void>();

  suggestionsIn: Suggestion[] = [];
  modelItems: Suggestion[] = [];
  inputCtrl: UntypedFormControl = new UntypedFormControl();
  separatorKeysCodes: number[] = DEFAULT_SEPARATOR_KEY_CODES;
  isAutoFocus = false;
  readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputElRef');
  readonly matAutocomplete = viewChild<MatAutocomplete>('autoElRef');
  private _modelIds: string[] = [];

  filteredSuggestions: Observable<Suggestion[]> = this.inputCtrl.valueChanges.pipe(
    startWith(''),
    map((val: string | null) =>
      val !== null
        ? this._filter(val)
        : this.suggestionsIn.filter(
            (suggestion) => !this._modelIds.includes(suggestion.id),
          ),
    ),
  );

  private _autoFocusTimeout?: number;

  constructor() {
    const autoFocus = this.autoFocus;

    if (typeof autoFocus === 'string') {
      this.isAutoFocus = true;
      this._autoFocusTimeout = window.setTimeout(() => {
        this.inputEl()?.nativeElement.focus();
        // NOTE: we need to wait a little for the tag dialog to be there
      }, 300);
    }
  }

  ngOnDestroy(): void {
    if (this._autoFocusTimeout) {
      window.clearTimeout(this._autoFocusTimeout);
    }
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set suggestions(val: Suggestion[]) {
    this.suggestionsIn = val.sort((a, b) => a.title.localeCompare(b.title));
    this._updateModelItems(this._modelIds);
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set model(v: string[]) {
    this._modelIds = v;
    this._updateModelItems(v);
  }

  add(event: MatChipInputEvent): void {
    const matAutocomplete = this.matAutocomplete();
    if (!matAutocomplete) {
      throw new Error('Auto complete undefined');
    }

    if (!matAutocomplete.isOpen) {
      const inp = event.input;
      const value = event.value;

      // Add our fruit
      if ((value || '').trim()) {
        this._addByTitle(value.trim());
      }

      inp.value = '';

      this.inputCtrl.setValue(null);
    }
  }

  remove(id: string): void {
    this.removeItem.emit(id);
  }

  selected(event: MatAutocompleteSelectedEvent): void {
    this._add(event.option.value);
    const inputEl = this.inputEl();
    if (inputEl) {
      inputEl.nativeElement.value = '';
    }
    this.inputCtrl.setValue(null);
  }

  isToggled(id: string): boolean {
    const toggledItems = this.toggledItems();
    return !!toggledItems && toggledItems.includes(id);
  }

  triggerCtrlEnterSubmit(ev: KeyboardEvent): void {
    const isCyrillic = /^[А-яёЁ]$/.test(ev.key);
    if (isCyrillic) {
      this.separatorKeysCodes = [ENTER];
    } else {
      this.separatorKeysCodes = DEFAULT_SEPARATOR_KEY_CODES;
    }

    if (ev.code === 'Enter' && ev.ctrlKey) {
      this.ctrlEnterSubmit.emit();
    }
  }

  private _updateModelItems(modelIds: string[]): void {
    this.modelItems = this.suggestionsIn.length
      ? (modelIds
          .map((id) => this.suggestionsIn.find((suggestion) => suggestion.id === id))
          .filter((v) => v) as Suggestion[])
      : [];
  }

  private _getExistingSuggestionByTitle(v: string): Suggestion | undefined {
    return this.suggestionsIn.find((suggestion) => suggestion.title === v);
  }

  private _add(id: string): void {
    // prevent double items
    if (!this._modelIds.includes(id)) {
      this.addItem.emit(id);
    }
  }

  private _addByTitle(v: string): void {
    const existing = this._getExistingSuggestionByTitle(v);
    if (existing) {
      this._add(existing.id);
    } else {
      this.addNewItem.emit(v);
    }
  }

  private _filter(val: string): Suggestion[] {
    if (!val) {
      return this.suggestionsIn;
    }

    const filterValue = val.toLowerCase();
    return this.suggestionsIn.filter(
      (suggestion) =>
        suggestion.title.toLowerCase().indexOf(filterValue) === 0 &&
        !this._modelIds.includes(suggestion.id),
    );
  }
}
