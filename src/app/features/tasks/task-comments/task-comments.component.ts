import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Task, TaskComment } from '../task.model';
import { TaskService } from '../task.service';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import {
  isNonEmptyTaskCommentBody,
  normalizeTaskCommentBody,
  sortTaskCommentsByCreated,
  wasTaskCommentEdited,
} from './task-comment.util';

@Component({
  selector: 'task-comments',
  templateUrl: './task-comments.component.html',
  styleUrls: ['./task-comments.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LocaleDatePipe, MatIcon, MatIconButton, NgTemplateOutlet],
})
export class TaskCommentsComponent {
  private readonly _taskService = inject(TaskService);

  readonly task = input.required<Task>();
  readonly T = T;

  readonly isAdding = signal(false);
  readonly editingCommentId = signal<string | null>(null);
  readonly draftText = signal('');

  readonly sortedComments = computed(() =>
    sortTaskCommentsByCreated(this.task().comments || []),
  );

  readonly hasComments = computed(() => this.sortedComments().length > 0);

  readonly isDraftMode = computed(() => this.isAdding() || !!this.editingCommentId());

  readonly canSaveDraft = computed(() => isNonEmptyTaskCommentBody(this.draftText()));

  readonly showAddButton = computed(
    () => !this.isAdding() && this.editingCommentId() === null,
  );

  @HostListener('click', ['$event'])
  @HostListener('keydown', ['$event'])
  stopPanelEvent(ev: Event): void {
    ev.stopPropagation();
  }

  startAdd(): void {
    this.editingCommentId.set(null);
    this.draftText.set('');
    this.isAdding.set(true);
  }

  startEdit(comment: TaskComment): void {
    this.isAdding.set(false);
    this.editingCommentId.set(comment.id);
    this.draftText.set(comment.body);
  }

  cancelEdit(): void {
    this.isAdding.set(false);
    this.editingCommentId.set(null);
    this.draftText.set('');
  }

  onDraftInput(value: string): void {
    this.draftText.set(value);
  }

  saveDraft(): void {
    const body = normalizeTaskCommentBody(this.draftText());
    if (!isNonEmptyTaskCommentBody(body)) {
      return;
    }
    const task = this.task();
    const editingId = this.editingCommentId();
    if (editingId) {
      this._taskService.updateComment(task, editingId, body);
    } else {
      this._taskService.addComment(task, body);
    }
    this.cancelEdit();
  }

  deleteComment(commentId: string): void {
    this._taskService.deleteComment(this.task(), commentId);
    if (this.editingCommentId() === commentId) {
      this.cancelEdit();
    }
  }

  onDraftKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.saveDraft();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancelEdit();
    }
  }

  isEditing(commentId: string): boolean {
    return this.editingCommentId() === commentId;
  }

  wasEdited(comment: TaskComment): boolean {
    return wasTaskCommentEdited(comment);
  }
}
