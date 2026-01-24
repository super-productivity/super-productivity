import { effect, Injectable, signal, WritableSignal } from '@angular/core';
import { Tag } from '../../tag/tag.model';
import { AddTaskBarState, INITIAL_ADD_TASK_BAR_STATE } from './add-task-bar.const';
import { toObservable } from '@angular/core/rxjs-interop';
import { SS } from '../../../core/persistence/storage-keys.const';
import { TimeSpentOnDay, TaskReminderOptionId } from '../task.model';
import { TaskAttachment } from '../task-attachment/task-attachment.model';

@Injectable()
export class AddTaskBarStateService {
  private readonly _taskInputState: WritableSignal<AddTaskBarState> = signal({
    ...INITIAL_ADD_TASK_BAR_STATE,
  });

  readonly inputTxt = signal(sessionStorage.getItem(SS.ADD_TASK_BAR_TXT) || '');
  readonly inputTxt$ = toObservable(this.inputTxt);
  readonly state = this._taskInputState.asReadonly();
  readonly isAutoDetected = signal(false);

  constructor() {
    effect(() => {
      sessionStorage.setItem(SS.ADD_TASK_BAR_TXT, this.inputTxt());
    });
  }

  updateProjectId(projectId: string): void {
    this._taskInputState.update((state) => ({ ...state, projectId }));
    // Clear auto-detected flag when manually changing project
    this.isAutoDetected.set(false);
  }

  updateDate(date: string | null, time?: string | null): void {
    this._taskInputState.update((state) => ({
      ...state,
      date,
      time: time !== undefined ? time : state.time,
    }));
  }

  updateTime(time: string | null): void {
    this._taskInputState.update((state) => ({ ...state, time }));
  }

  updateSpent(spent: TimeSpentOnDay | null): void {
    this._taskInputState.update((state) => ({ ...state, spent }));
  }

  updateRemindOption(remindOption: TaskReminderOptionId | null): void {
    this._taskInputState.update((state) => ({ ...state, remindOption }));
  }

  updateEstimate(estimate: number | null): void {
    this._taskInputState.update((state) => ({ ...state, estimate }));
  }

  toggleTag(tag: Tag, cleanedInputTxt?: string): void {
    this._taskInputState.update((state) => {
      const isSelected = state.tagIds.includes(tag.id);
      return {
        ...state,
        tagIds: isSelected
          ? state.tagIds.filter((id) => id !== tag.id)
          : [...state.tagIds, tag.id],
      };
    });
    if (cleanedInputTxt !== undefined) {
      this.inputTxt.set(cleanedInputTxt);
    }
  }

  updateTagIds(tagIds: string[]): void {
    this._taskInputState.update((state) => ({ ...state, tagIds }));
  }

  updateTagIdsFromTxt(tagIdsFromTxt: string[]): void {
    this._taskInputState.update((state) => ({ ...state, tagIdsFromTxt }));
  }

  updateNewTagTitles(newTagTitles: string[]): void {
    this._taskInputState.update((state) => ({ ...state, newTagTitles }));
  }

  updateCleanText(cleanText: string | null): void {
    this._taskInputState.update((state) => ({ ...state, cleanText }));
  }

  updateInputTxt(inputTxt: string): void {
    this.inputTxt.set(inputTxt);
  }

  clearTags(cleanedInputTxt?: string): void {
    this._taskInputState.update((state) => ({
      ...state,
      tagIds: [],
      tagIdsFromTxt: [],
      newTagTitles: [],
    }));
    if (cleanedInputTxt !== undefined) {
      this.inputTxt.set(cleanedInputTxt);
    }
  }

  clearDate(cleanedInputTxt?: string): void {
    this._taskInputState.update((state) => ({ ...state, date: null, time: null }));
    if (cleanedInputTxt !== undefined) {
      this.inputTxt.set(cleanedInputTxt);
    }
  }

  clearEstimate(cleanedInputTxt?: string): void {
    this._taskInputState.update((state) => ({ ...state, estimate: null }));
    if (cleanedInputTxt !== undefined) {
      this.inputTxt.set(cleanedInputTxt);
    }
  }

  updateAttachments(attachments: TaskAttachment[]): void {
    this._taskInputState.update((state) => ({ ...state, attachments }));
  }

  clearAttachments(cleanedInputTxt?: string): void {
    this._taskInputState.update((state) => ({ ...state, attachments: [] }));
    if (cleanedInputTxt !== undefined) {
      this.inputTxt.set(cleanedInputTxt);
    }
  }

  resetAfterAdd(): void {
    // Only clear input text and tags, preserve project, date, and estimate
    this._taskInputState.update((state) => ({
      ...state,
      tagIds: [],
      tagIdsFromTxt: [],
      newTagTitles: [],
      cleanText: null,
      attachments: [],
    }));
    this.inputTxt.set('');
    // Keep isAutoDetected as is to preserve project selection
  }

  setAutoDetectedProjectId(projectId: string): void {
    this.updateProjectId(projectId);
    this.isAutoDetected.set(true);
  }
}
