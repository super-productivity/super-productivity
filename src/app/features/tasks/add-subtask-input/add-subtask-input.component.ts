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
    const title = this.titleDraft().trim();
    if (!title) {
      return;
    }

    this._taskService.addSubTaskTo(this.parentId(), { title });
    this.titleDraft.set('');

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
