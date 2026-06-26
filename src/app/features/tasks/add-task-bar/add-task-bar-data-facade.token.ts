import { InjectionToken, Signal, WritableSignal } from '@angular/core';
import { Observable } from 'rxjs';
import type { Project } from '../../project/project.model';
import type { Tag } from '../../tag/tag.model';
import type { WorkContext } from '../../work-context/work-context.model';
import type { TasksConfig, ShortSyntaxConfig } from '../../config/global-config.model';
import type { TaskReminderOptionId } from '../task.model';
import type { AddTaskSuggestion } from './add-task-suggestions.model';
import type { AddTaskPayload } from './add-task-payload-builder';
import type { MentionConfig } from '../../../ui/mentions/mention-config';

export interface AddTaskBarSuggestionResult {
  taskId: string;
  isAddToBottom: boolean;
}

export interface AddTaskBarDataFacade {
  readonly isSubmitDelegated: boolean;
  readonly projects: Signal<Project[]>;
  readonly projects$: Observable<Project[]>;
  readonly tags$: Observable<Tag[]>;
  readonly tagsNoMyDayAndNoListSorted$: Observable<Tag[]>;
  readonly tagsNoMyDayAndNoListInTreeOrder: Signal<Tag[]>;
  readonly activeWorkContext$: Observable<WorkContext | null>;
  readonly tasksConfig$: Observable<TasksConfig>;
  readonly shortSyntax$: Observable<ShortSyntaxConfig>;
  readonly mentionConfig$: Observable<MentionConfig>;
  readonly projectFolderMap: Signal<Map<string, string>>;
  readonly tagFolderMap: Signal<Map<string, string>>;

  defaultTaskRemindOption(): TaskReminderOptionId;
  todayStr(): string;
  getLogicalTodayDate(): Date;
  currentLocale(): string;
  formatTime(timestamp: number): string;
  submitTask(payload: AddTaskPayload): Promise<string>;
  createNewTags(tagTitles: string[]): Promise<string[]>;
  isMarkdownTaskList(text: string): boolean;
  handleMarkdownPaste(pastedText: string): Promise<void>;
  getIssueIcon(issueType: AddTaskSuggestion['issueType']): string | undefined;
  getFilteredIssueSuggestions$(
    input$: Observable<string>,
    isSearchIssueProviders$: Observable<boolean>,
    isSearchLoading: WritableSignal<boolean>,
  ): Observable<AddTaskSuggestion[]>;
  handleSuggestionSelected(
    suggestion: AddTaskSuggestion,
    planForDay: string | undefined,
    isAddToBacklog: boolean,
    isAddToBottom: boolean,
  ): Promise<AddTaskBarSuggestionResult | null>;
  onHudOpened(listener: () => void): () => void;
}

export const ADD_TASK_BAR_DATA_FACADE = new InjectionToken<AddTaskBarDataFacade>(
  'ADD_TASK_BAR_DATA_FACADE',
);
