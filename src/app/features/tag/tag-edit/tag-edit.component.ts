import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import {
  MatChipGrid,
  MatChipInput,
  MatChipInputEvent,
  MatChipRemove,
  MatChipRow,
} from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';
import { ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { T } from '../../../t.const';
import { TagService } from '../tag.service';
import { TaskService } from '../../tasks/task.service';
import { TaskCopy } from '../../tasks/task.model';
import { TagComponent } from '../tag/tag.component';
import { TranslatePipe } from '@ngx-translate/core';
import { TODAY_TAG } from '../tag.const';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface Suggestion {
  id: string;
  title: string;

  [key: string]: any;
}

const DEFAULT_SEPARATOR_KEY_CODES: number[] = [ENTER, COMMA];

@Component({
  selector: 'tag-edit',
  standalone: true,
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatChipGrid,
    MatChipInput,
    MatChipRow,
    MatIcon,
    MatChipRemove,
    TagComponent,
    ReactiveFormsModule,
    MatOption,
    TranslatePipe,
  ],
  templateUrl: './tag-edit.component.html',
  styleUrl: './tag-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagEditComponent {
  T: typeof T = T;

  private _tagService = inject(TagService);
  private _taskService = inject(TaskService);
  private readonly _destroyRef = inject(DestroyRef);

  task = input<TaskCopy>();
  isShowMyDayTag = input<boolean>(false);
  tagIds = input.required<string[]>();
  excludedTagIds = input<string[]>();
  tagUpdate = output<string[]>();

  escapePress = output<void>();

  inputCtrl: UntypedFormControl = new UntypedFormControl();
  separatorKeysCodes: number[] = DEFAULT_SEPARATOR_KEY_CODES;

  readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputElRef');
  readonly matAutocomplete = viewChild<MatAutocomplete>('autoElRef');

  inputVal = signal<string>('');
  tagSuggestions = computed(() =>
    this.isShowMyDayTag()
      ? this._tagService.tagsInTreeOrder()
      : this._tagService.tagsNoMyDayAndNoListInTreeOrder(),
  );

  constructor() {
    this.inputCtrl.valueChanges
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((value: string | null) => {
        this.inputVal.set(value ?? '');
      });
  }

  allExcludedTagIds = computed<string[]>(() => [
    ...this.tagIds(),
    ...(this.excludedTagIds() || []),
    TODAY_TAG.id,
  ]);
  filteredSuggestions = computed(() => {
    const val = this.inputVal();
    const allExcludedTagIds = this.allExcludedTagIds();

    if (!val) {
      return this.tagSuggestions().filter(
        (suggestion) => !allExcludedTagIds.includes(suggestion.id),
      );
    }
    const filterValue = val.toLowerCase();

    return this.tagSuggestions().filter(
      (suggestion) =>
        suggestion.title.toLowerCase().indexOf(filterValue) === 0 &&
        !allExcludedTagIds.includes(suggestion.id),
    );
  });

  tagItems = computed<Suggestion[]>(() => {
    const suggestions = this.tagSuggestions();
    return suggestions.length
      ? (this.tagIds()
          .map((id) => suggestions.find((suggestion) => suggestion.id === id))
          .filter((v) => v) as Suggestion[])
      : [];
  });

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

  onKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      this.escapePress.emit();
    }
  }

  focusInput(): void {
    const inputEl = this.inputEl();
    if (inputEl) {
      inputEl.nativeElement.focus();
    }
  }

  remove(id: string): void {
    this._updateModel(this.tagIds().filter((tid) => tid !== id));
  }

  selected(event: MatAutocompleteSelectedEvent): void {
    this._add(event.option.value);
    const inputEl = this.inputEl();
    if (inputEl) {
      inputEl.nativeElement.value = '';
    }
    this.inputCtrl.setValue(null);
  }

  private _updateModel(v: string[]): void {
    this.tagUpdate.emit(v);
    const task = this.task();
    if (task) {
      this._taskService.updateTags(task, v);
    }
  }

  private _getExistingSuggestionByTitle(v: string): Suggestion | undefined {
    return this.tagSuggestions().find((suggestion) => suggestion.title === v);
  }

  private _add(id: string): void {
    // prevent double items
    if (!this.tagIds().includes(id)) {
      this._updateModel([...this.tagIds(), id]);
    }
  }

  private _addByTitle(v: string): void {
    const existing = this._getExistingSuggestionByTitle(v);
    if (existing) {
      if (!this.allExcludedTagIds().includes(existing.id)) {
        this._add(existing.id);
      }
    } else {
      this._createNewTag(v);
    }
  }

  private _createNewTag(title: string): void {
    const cleanTitle = (t: string): string => {
      return t.replace('#', '');
    };

    const id = this._tagService.addTag({ title: cleanTitle(title) });
    this._add(id);
  }

  protected readonly onkeydown = onkeydown;
}
