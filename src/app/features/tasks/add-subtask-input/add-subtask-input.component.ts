import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatInput } from '@angular/material/input';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TaskService } from '../task.service';

@Component({
  selector: 'add-subtask-input',
  templateUrl: './add-subtask-input.component.html',
  styleUrl: './add-subtask-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatInput],
})
export class AddSubtaskInputComponent {
  private readonly _taskService = inject(TaskService);
  private readonly _translateService = inject(TranslateService);
  private _isKeepingOpenAfterSubmit = false;
  private _isClosedWithoutSubmit = false;
  private _removeDocumentKeydownListener?: () => void;

  readonly parentId = input.required<string>();
  readonly closed = output<void>();
  readonly titleDraft = signal('');
  readonly placeholder = this._translateService.instant(
    T.F.TASK.CMP.ADD_SUB_TASK_PLACEHOLDER,
  );
  readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  focus(): void {
    window.setTimeout(() => this.inputEl()?.nativeElement.focus());
  }

  onInput(ev: Event): void {
    this.titleDraft.set((ev.target as HTMLInputElement).value);
  }

  onFocus(): void {
    if (this._removeDocumentKeydownListener) {
      return;
    }

    document.addEventListener('keydown', this._onDocumentKeydown, true);
    this._removeDocumentKeydownListener = () => {
      document.removeEventListener('keydown', this._onDocumentKeydown, true);
      this._removeDocumentKeydownListener = undefined;
    };
  }

  onKeydown(ev: KeyboardEvent): void {
    ev.stopPropagation();

    if (ev.key === 'Escape') {
      ev.preventDefault();
      this._close();
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
      this._removeDocumentKeydownListener?.();
      return;
    }

    this._removeDocumentKeydownListener?.();
    this._close();
  }

  private _commit(): boolean {
    const title = this.titleDraft().trim();
    if (!title) {
      return false;
    }

    this._taskService.addSubTaskTo(this.parentId(), { title });
    this.titleDraft.set('');

    this._isKeepingOpenAfterSubmit = true;
    this.focus();
    window.setTimeout(() => {
      this.focus();
    }, 100);
    window.setTimeout(() => {
      this._isKeepingOpenAfterSubmit = false;
    }, 150);

    return true;
  }

  private _close(): void {
    if (this._isClosedWithoutSubmit) {
      return;
    }
    this._isClosedWithoutSubmit = true;
    this._removeDocumentKeydownListener?.();
    this.titleDraft.set('');
    this.closed.emit();
  }

  private readonly _onDocumentKeydown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || document.activeElement !== this.inputEl()?.nativeElement) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    this._close();
  };
}
