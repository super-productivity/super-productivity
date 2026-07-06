import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TaskService } from '../task.service';

/**
 * Why the inline draft input closed. `escape` is a keyboard cancel, so the
 * host should return focus to the task row; `blur` means focus already moved
 * elsewhere and must not be stolen back.
 */
export type AddSubtaskInputCloseReason = 'escape' | 'blur';

@Component({
  selector: 'add-subtask-input',
  templateUrl: './add-subtask-input.component.html',
  styleUrl: './add-subtask-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatInput, TranslatePipe],
})
export class AddSubtaskInputComponent {
  private readonly _taskService = inject(TaskService);
  private readonly _injector = inject(Injector);
  private _isKeepingOpenAfterSubmit = false;
  private _isClosedWithoutSubmit = false;

  readonly T = T;
  readonly parentId = input.required<string>();
  readonly closed = output<AddSubtaskInputCloseReason>();
  readonly titleDraft = signal('');
  readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    // Own the initial focus instead of relying solely on the host's
    // post-render setTimeout: on a slow machine that timeout can fire before
    // this view's change detection commits the inputEl viewChild, so the
    // draft opens but never gets focused (and is then torn down). afterNextRender
    // is tied to the render lifecycle, so inputEl is guaranteed ready here.
    afterNextRender(() => this.focus());
  }

  focus(): void {
    this.inputEl()?.nativeElement.focus();
  }

  onKeydown(ev: KeyboardEvent): void {
    ev.stopPropagation();

    if (ev.key === 'Escape') {
      ev.preventDefault();
      this._close('escape');
      return;
    }

    if (
      ev.key === 'Enter' &&
      !ev.repeat &&
      !ev.isComposing &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      !ev.shiftKey
    ) {
      ev.preventDefault();
      this._commit();
    }
  }

  onBlur(): void {
    if (this._isKeepingOpenAfterSubmit || this._isClosedWithoutSubmit) {
      return;
    }

    this._close('blur');
  }

  private _commit(): void {
    // Read the live DOM value rather than the titleDraft signal: Angular's
    // DefaultValueAccessor buffers ngModelChange during IME / predictive-text
    // composition, so the signal can still be empty when Enter is pressed
    // mid-composition (the composition only ends — and the signal only
    // updates — once a trailing space or punctuation is typed). The input
    // element itself always holds the current text. Enter that instead
    // *confirms* an IME candidate carries isComposing and is already filtered
    // out in onKeydown, so this only commits genuinely-entered text. The
    // signal is a defensive fallback for the impossible case of inputEl being
    // unresolved (_commit only runs from a keydown on the rendered input).
    const inputEl = this.inputEl()?.nativeElement;
    const title = (inputEl?.value ?? this.titleDraft()).trim();
    if (!title) {
      return;
    }

    this._taskService.addSubTaskTo(this.parentId(), { title });
    this.titleDraft.set('');
    // Clear the element directly too: when composition buffering kept the
    // signal empty, it is already '' and re-setting it would not write the
    // cleared value back through the one-way [ngModel] binding.
    if (inputEl) {
      inputEl.value = '';
    }

    this._isKeepingOpenAfterSubmit = true;
    afterNextRender(
      () => {
        this.focus();
        this._isKeepingOpenAfterSubmit = false;
      },
      { injector: this._injector },
    );
  }

  private _close(reason: AddSubtaskInputCloseReason): void {
    if (this._isClosedWithoutSubmit) {
      return;
    }
    this._isClosedWithoutSubmit = true;
    this.titleDraft.set('');
    this.closed.emit(reason);
  }
}
