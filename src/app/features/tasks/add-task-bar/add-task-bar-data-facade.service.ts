import { computed, inject, Injectable, WritableSignal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { WorkContextType } from '../../work-context/work-context.model';
import { TaskReminderOptionId } from '../task.model';
import { AddTaskSuggestion } from './add-task-suggestions.model';
import { AddTaskPayload } from './add-task-payload-builder';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { AddTaskBarIssueSearchService } from './add-task-bar-issue-search.service';
import { TaskService } from '../task.service';
import { TaskBuilderService } from '../task-builder.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DateService } from '../../../core/date/date.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { PlannerActions } from '../../planner/store/planner.actions';
import { T } from '../../../t.const';
import { truncate } from '../../../util/truncate';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import {
  AddTaskBarDataFacade,
  AddTaskBarSuggestionResult,
} from './add-task-bar-data-facade.token';
import { MentionConfigService } from '../mention-config.service';
import { MarkdownPasteService } from '../markdown-paste.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { ISSUE_PROVIDER_ICON_MAP } from '../../issue/issue.const';
import { BuiltInIssueProviderKey } from '../../issue/issue.model';

@Injectable({
  providedIn: 'root',
})
export class FullAddTaskBarDataFacadeService implements AddTaskBarDataFacade {
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _addTaskBarIssueSearchService = inject(AddTaskBarIssueSearchService);
  private readonly _taskService = inject(TaskService);
  private readonly _taskBuilderService = inject(TaskBuilderService);
  private readonly _snackService = inject(SnackService);
  private readonly _store = inject(Store);
  private readonly _dateService = inject(DateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  private readonly _menuTreeService = inject(MenuTreeService);
  private readonly _mentionConfigService = inject(MentionConfigService);
  private readonly _markdownPasteService = inject(MarkdownPasteService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);

  readonly isSubmitDelegated = false;
  readonly projects = this._projectService.listInTreeOrderForUI;
  readonly projects$ = toObservable(this.projects);
  readonly tags$ = this._tagService.tags$;
  readonly tagsNoMyDayAndNoListSorted$ = this._tagService.tagsNoMyDayAndNoListSorted$;
  readonly tagsNoMyDayAndNoListInTreeOrder =
    this._tagService.tagsNoMyDayAndNoListInTreeOrder;
  readonly activeWorkContext$ = this._workContextService.activeWorkContext$;
  readonly tasksConfig$ = this._globalConfigService.tasks$;
  readonly shortSyntax$ = this._globalConfigService.shortSyntax$;
  readonly mentionConfig$ = this._mentionConfigService.mentionConfig$;
  readonly projectFolderMap = computed(() => this._menuTreeService.projectFolderMap());
  readonly tagFolderMap = computed(() => this._menuTreeService.tagFolderMap());

  defaultTaskRemindOption(): TaskReminderOptionId {
    return (
      this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!
    );
  }

  todayStr(): string {
    return this._dateService.todayStr();
  }

  getLogicalTodayDate(): Date {
    return this._dateService.getLogicalTodayDate();
  }

  currentLocale(): string {
    return this._dateTimeFormatService.currentLocale();
  }

  formatTime(timestamp: number): string {
    return this._dateTimeFormatService.formatTime(timestamp);
  }

  async submitTask(payload: AddTaskPayload): Promise<string> {
    return await this._taskBuilderService.addTask(payload);
  }

  async createNewTags(tagTitles: string[]): Promise<string[]> {
    return tagTitles.map((title) => this._tagService.addTag({ title }));
  }

  isMarkdownTaskList(text: string): boolean {
    return this._markdownPasteService.isMarkdownTaskList(text);
  }

  async handleMarkdownPaste(pastedText: string): Promise<void> {
    await this._markdownPasteService.handleMarkdownPaste(pastedText, null);
  }

  getIssueIcon(issueType: AddTaskSuggestion['issueType']): string | undefined {
    if (!issueType) {
      return undefined;
    }
    if (this._pluginRegistry.hasProvider(issueType)) {
      const icon = this._pluginRegistry.getIcon(issueType);
      return icon === 'extension' ? undefined : icon;
    }
    return ISSUE_PROVIDER_ICON_MAP[issueType as BuiltInIssueProviderKey];
  }

  getFilteredIssueSuggestions$(
    input$: Observable<string>,
    isSearchIssueProviders$: Observable<boolean>,
    isSearchLoading: WritableSignal<boolean>,
  ): Observable<AddTaskSuggestion[]> {
    return this._addTaskBarIssueSearchService.getFilteredIssueSuggestions$(
      input$,
      isSearchIssueProviders$,
      isSearchLoading,
    );
  }

  async handleSuggestionSelected(
    suggestion: AddTaskSuggestion,
    planForDay: string | undefined,
    isAddToBacklog: boolean,
    isAddToBottom: boolean,
  ): Promise<AddTaskBarSuggestionResult | null> {
    let taskId: string | undefined;
    let didPlanForDay = false;

    if (suggestion.taskId && suggestion.isFromOtherContextAndTagOnlySearch) {
      if (planForDay) {
        await this._planTaskForCurrentDay(suggestion.taskId, planForDay, isAddToBottom);
        didPlanForDay = true;
      } else if (this._workContextService.activeWorkContextType === WorkContextType.TAG) {
        const task = await firstValueFrom(
          this._taskService.getByIdOnce$(suggestion.taskId),
        );
        this._taskService.moveToCurrentWorkContext(task);
      }
      this._snackService.open({
        ico: 'playlist_add',
        msg: T.F.TASK.S.FOUND_MOVE_FROM_OTHER_LIST,
        translateParams: {
          title: truncate(suggestion.title),
          contextTitle: suggestion.ctx?.title
            ? truncate(suggestion.ctx.title)
            : '~the void~',
        },
      });
      taskId = suggestion.taskId;
    } else if (suggestion.taskId) {
      if (planForDay) {
        await this._planTaskForCurrentDay(suggestion.taskId, planForDay, isAddToBottom);
        didPlanForDay = true;
      } else {
        const task = await firstValueFrom(
          this._taskService.getByIdOnce$(suggestion.taskId),
        );
        this._taskService.moveToCurrentWorkContext(task);
      }

      if (suggestion.isArchivedTask) {
        this._snackService.open({
          ico: 'unarchive',
          msg: T.F.TASK.S.FOUND_RESTORE_FROM_ARCHIVE,
          translateParams: { title: suggestion.title },
        });
      } else if (suggestion.projectId) {
        this._snackService.open({
          ico: 'arrow_upward',
          msg: T.F.TASK.S.FOUND_MOVE_FROM_BACKLOG,
          translateParams: { title: suggestion.title },
        });
      }

      taskId = suggestion.taskId;
    } else if (suggestion.issueType && suggestion.issueData) {
      taskId = await this._addTaskBarIssueSearchService.addTaskFromExistingTaskOrIssue(
        suggestion,
        isAddToBacklog,
        true,
      );
    }

    if (taskId && planForDay && !didPlanForDay) {
      await this._planTaskForCurrentDay(taskId, planForDay, isAddToBottom);
    }

    return taskId ? { taskId, isAddToBottom: false } : null;
  }

  onHudOpened(_listener: () => void): () => void {
    return () => undefined;
  }

  private async _planTaskForCurrentDay(
    taskId: string,
    planForDay: string,
    isAddToBottom: boolean,
  ): Promise<void> {
    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    if (!task) {
      return;
    }

    this._store.dispatch(
      PlannerActions.planTaskForDay({
        task,
        day: planForDay,
        isAddToTop: !isAddToBottom,
      }),
    );
  }
}
