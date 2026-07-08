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
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { isTouchActive } from '../../../util/input-intent';
import { TaskService } from '../task.service';

/**
 * Why the inline draft input closed. `escape` is a keyboard cancel (the draft
 * is discarded and focus returns to the task row); `blur` means focus already
 * moved elsewhere, so any pending draft is committed and focus is not stolen
 * back.
 */
export type AddSubtaskInputCloseReason = 'escape' | 'blur';

@Component({
  selector: 'add-subtask-input',
  templateUrl: './add-subtask-input.component.html',
  styleUrl: './add-subtask-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatInput, MatIconButton, MatIcon, TranslatePipe],
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

    // On touch, the natural "done" gesture is tapping away, and the soft-keyboard
    // Enter is unreliable (several IME/WebView combos, e.g. GrapheneOS/Vanadium,
    // deliver it as a composing keydown that onKeydown ignores) with no
    // tab-to-button, so blur must save the draft (#8791/#8856). On desktop, Enter
    // and the submit button are reliable, so blur cancels — the long-standing
    // behaviour — rather than silently creating a task on click-away, and a user
    // can move to the button without the draft being committed out from under
    // them. Escape always discards: it sets _isClosedWithoutSubmit, so its
    // trailing blur is skipped by the guard above.
    if (this._shouldCommitOnBlur()) {
      this._addSubtaskFromInput();
    }
    this._close('blur');
  }

  /** Commit the draft on blur only on touch — see onBlur. Overridable in specs. */
  protected _shouldCommitOnBlur(): boolean {
    return isTouchActive();
  }

  /**
   * Submit button handler. The button's mousedown is preventDefaulted (template)
   * so on desktop the click does not blur the input away first; this commits and
   * keeps the field open for rapid entry, mirroring the main add-task bar. On
   * touch, tapping the button usually blurs the input and commits via onBlur, so
   * this then reads the already-cleared value and is a no-op. Reuses _commit,
   * which reads the live value, so it works mid-composition.
   */
  onSubmitClick(): void {
    this._commit();
  }

  private _commit(): void {
    // Enter that *confirms* an IME candidate carries isComposing and is already
    // filtered out in onKeydown, so this only runs for genuinely-entered text.
    if (!this._addSubtaskFromInput()) {
      return;
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

  /**
   * Add a sub-task from the current input text; returns whether one was added.
   *
   * Reads the live DOM value rather than the titleDraft signal: Angular's
   * DefaultValueAccessor buffers ngModelChange during IME / predictive-text
   * composition, so the signal can still be empty when the user submits
   * mid-composition (the composition only ends — and the signal only updates —
   * once a trailing space or punctuation is typed). The input element itself
   * always holds the current text. The signal is a defensive fallback for the
   * impossible case of inputEl being unresolved.
   */
  private _addSubtaskFromInput(): boolean {
    const inputEl = this.inputEl()?.nativeElement;
    const title = (inputEl?.value ?? this.titleDraft()).trim();
    if (!title) {
      return false;
    }

    this._taskService.addSubTaskTo(this.parentId(), { title });
    this.titleDraft.set('');
    // Clear the element directly too: when composition buffering kept the
    // signal empty, it is already '' and re-setting it would not write the
    // cleared value back through the one-way [ngModel] binding.
    if (inputEl) {
      inputEl.value = '';
    }
    return true;
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
