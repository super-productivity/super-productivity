import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MentionConfig, MentionItem, MentionModule } from '../../../ui/mentions';
import { MatInput } from '@angular/material/input';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { AsyncPipe } from '@angular/common';
import { LS } from '../../../core/persistence/storage-keys.const';
import { blendInOutAnimation } from 'src/app/ui/animations/blend-in-out.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { TaskCopy } from '../task.model';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { AddTaskBarIssueSearchService } from './add-task-bar-issue-search.service';
import { T } from '../../../t.const';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  startWith,
  timeout,
  withLatestFrom,
} from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import {
  MatAutocomplete,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { AddTaskSuggestion } from './add-task-suggestions.model';
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { TagComponent } from '../../tag/tag/tag.component';
import { truncate } from '../../../util/truncate';
import { SnackService } from '../../../core/snack/snack.service';
import { AddTaskBarStateService } from './add-task-bar-state.service';
import { AddTaskBarParserService } from './add-task-bar-parser.service';
import { AddTaskBarActionsComponent } from './add-task-bar-actions/add-task-bar-actions.component';
import { Mentions } from '../../../ui/mentions/mention-config';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { unique } from '../../../util/unique';
import { CHRONO_SUGGESTIONS } from './add-task-bar.const';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ShortSyntaxTag, shortSyntaxToTags } from './short-syntax-to-tags';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { Log } from '../../../core/log';
import { TODAY_TAG } from '../../tag/tag.const';
import { BodyClass } from '../../../app.constants';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { Store } from '@ngrx/store';
import { PlannerActions } from '../../planner/store/planner.actions';

@Component({
  selector: 'add-task-bar',
  templateUrl: './add-task-bar.component.html',
  styleUrls: ['./add-task-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [blendInOutAnimation, fadeAnimation],
  standalone: true,
  imports: [
    FormsModule,
    MatInput,
    MatIconButton,
    MatIcon,
    MatTooltip,
    AsyncPipe,
    MentionModule,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    MatProgressSpinner,
    IssueIconPipe,
    TagComponent,
    AddTaskBarActionsComponent,
    TranslateModule,
  ],
  providers: [AddTaskBarStateService, AddTaskBarParserService],
})
export class AddTaskBarComponent implements AfterViewInit, OnInit, OnDestroy {
  private readonly _taskService = inject(TaskService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _addTaskBarIssueSearchService = inject(AddTaskBarIssueSearchService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _parserService = inject(AddTaskBarParserService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _translateService = inject(TranslateService);
  private readonly _store = inject(Store);
  readonly stateService = inject(AddTaskBarStateService);

  T = T;

  // Inputs
  tabindex = input<number>(0);
  isGlobalBarVariant = input<boolean>(false);
  isDisableAutoFocus = input<boolean>(false);
  isNoDefaults = input<boolean>(false);
  additionalFields = input<Partial<TaskCopy>>();
  taskIdsToExclude = input<string[]>();
  isHideTagTitles = input<boolean>(false);
  tagsToRemove = input<string[]>([]);
  planForDay = input<string>();

  // Outputs
  afterTaskAdd = output<{ taskId: string; isAddToBottom: boolean }>();
  closed = output<void>();
  done = output<void>();

  // Local UI state
  isAddToBottom = signal(
    JSON.parse(localStorage.getItem(LS.IS_ADD_TO_BOTTOM) || 'false'),
  );
  isAddToBacklog = signal(false);
  isSearchMode = signal(false);
  isSearchLoading = signal(false);
  activatedSuggestion$ = new BehaviorSubject<AddTaskSuggestion | null>(null);
  isMentionListShown = signal(false);
  isScheduleDialogOpen = signal(false);

  // Computed signals for projects and tags (sorted for consistency)
  projects = this._projectService.listSortedForUI;
  // Observable version for compatibility with existing code
  projects$ = toObservable(this.projects);
  tags$ = this._tagService.tags$;
  suggestions$!: Observable<AddTaskSuggestion[]>;
  activatedIssueTask = toSignal(this.activatedSuggestion$, { initialValue: null });

  // Computed values
  hasNewTags = computed(() => this.stateService.state().newTagTitles.length > 0);
  currentProject = computed(() =>
    this.projects().find((p) => p.id === this.stateService.state().projectId),
  );
  nrOfRightBtns = computed(() => {
    let count = 2;
    if (this.stateService.inputTxt().length > 0) {
      count++;
    }
    if (this.currentProject()?.isEnableBacklog) {
      count++;
    }
    return count;
  });

  defaultProject$ = combineLatest([
    this.projects$,
    this._workContextService.activeWorkContext$,
    this._globalConfigService.tasks$,
  ]).pipe(
    map(([projects, workContext, tasksConfig]) => {
      // Priority order:
      // 1. If current work context is a project → use that project
      // 2. If tasks.defaultProjectId is configured → use that project
      // 3. Otherwise → fall back to INBOX_PROJECT
      const defaultProject =
        (workContext?.type === WorkContextType.PROJECT
          ? projects.find((p) => p.id === workContext.id)
          : null) ||
        (tasksConfig.defaultProjectId
          ? projects.find((p) => p.id === tasksConfig.defaultProjectId)
          : null) ||
        projects.find((p) => p.id === 'INBOX_PROJECT');
      return defaultProject;
    }),
  );

  defaultDateAndTime$ = this._workContextService.activeWorkContext$.pipe(
    map((workContext) => {
      if (!this.isNoDefaults()) {
        if (this.planForDay()) {
          return {
            date: this.planForDay()!,
            time: undefined as string | undefined,
          };
        } else if (
          workContext?.type === WorkContextType.TAG &&
          workContext?.id === 'TODAY'
        ) {
          return {
            date: getDbDateStr(),
            time: undefined as string | undefined,
          };
        }
      }
      return {
        date: undefined as string | undefined,
        time: undefined as string | undefined,
      };
    }),
  );

  // Create observable from signal in injection context
  private readonly _isSearchIssueProviders$ = toObservable(this.isSearchMode);

  // Tag mention functionality - will be initialized in ngOnInit
  tagMentions$: Observable<ShortSyntaxTag[]> = this.stateService.inputTxt$.pipe(
    filter((val) => typeof val === 'string'),
    withLatestFrom(
      this._tagService.tagsNoMyDayAndNoListSorted$,
      this._projectService.listSorted$,
      this._workContextService.activeWorkContext$,
      this._globalConfigService.shortSyntax$,
    ),
    map(([val, tags, projects, activeWorkContext, shortSyntaxConfig]) =>
      shortSyntaxToTags({
        val,
        tags,
        projects,
        defaultColor: activeWorkContext?.theme?.primary || DEFAULT_PROJECT_COLOR,
        shortSyntaxConfig,
      }),
    ),
    startWith([]),
  );

  mentionCfg$ = combineLatest([
    this._globalConfigService.shortSyntax$,
    this._tagService.tagsNoMyDayAndNoListSorted$,
    this._projectService.listSortedForUI$,
  ]).pipe(
    map(([cfg, tagSuggestions, projectSuggestions]) => {
      const mentions: Mentions[] = [];
      if (cfg.isEnableTag) {
        mentions.push({
          items: (tagSuggestions as unknown as MentionItem[]) || [],
          labelKey: 'title',
          triggerChar: '#',
        });
      }
      if (cfg.isEnableDue) {
        mentions.push({
          items: CHRONO_SUGGESTIONS,
          labelKey: 'title',
          triggerChar: '@',
        });
      }
      if (cfg.isEnableProject) {
        mentions.push({
          items: (projectSuggestions as unknown as MentionItem[]) || [],
          labelKey: 'title',
          triggerChar: '+',
        });
      }
      const mentionCfg: MentionConfig = {
        mentions,
        triggerChar: undefined,
      };
      return mentionCfg;
    }),
  );

  // View children
  inputEl = viewChild<ElementRef>('inputEl');
  taskAutoCompleteEl = viewChild<MatAutocomplete>('taskAutoCompleteEl');
  actionsComponent = viewChild(AddTaskBarActionsComponent);

  private _focusTimeout?: number;
  private _autocompleteTimeout?: number;
  private _processingAutocompleteSelection = false;

  ngOnInit(): void {
    this._setProjectInitially();
    this._setTagInitially();
    this._setupDefaultDate();
    this._setupTextParsing();
    this._setupSuggestions();

    document.body.classList.add(BodyClass.isAddTaskBarOpen);
  }

  ngAfterViewInit(): void {
    if (!this.isDisableAutoFocus()) {
      this.focusInput(true);
    }
  }

  ngOnDestroy(): void {
    window.clearTimeout(this._focusTimeout);
    window.clearTimeout(this._autocompleteTimeout);
    document.body.classList.remove(BodyClass.isAddTaskBarOpen);
  }

  // Setup methods
  private _setProjectInitially(): void {
    this.defaultProject$
      .pipe(first(), takeUntilDestroyed(this._destroyRef))
      .subscribe((defaultProject) => {
        if (defaultProject) {
          this.stateService.updateProjectId(defaultProject.id);
        }
      });
  }

  private _setTagInitially(): void {
    if (this.isNoDefaults()) {
      return;
    }

    this._workContextService.activeWorkContext$
      .pipe(first(), takeUntilDestroyed(this._destroyRef))
      .subscribe((workContext) => {
        if (
          workContext?.type === WorkContextType.TAG &&
          workContext.id !== TODAY_TAG.id
        ) {
          this.stateService.updateTagIds([workContext.id]);
        }
      });
  }

  private _setupDefaultDate(): void {
    this.defaultDateAndTime$
      .pipe(first(), takeUntilDestroyed(this._destroyRef))
      .subscribe(({ date, time }) => {
        if (date) {
          this.stateService.updateDate(date, time);
        }
      });
  }

  private _setupTextParsing(): void {
    combineLatest([
      this.stateService.inputTxt$.pipe(distinctUntilChanged()),
      this._globalConfigService.shortSyntax$,
      this.tags$,
      this.projects$,
      this.defaultProject$,
      this.defaultDateAndTime$,
    ])
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(
        ([title, config, allTags, allProjects, defaultProject, defaultDateInfo]) => {
          const { date, time } = defaultDateInfo;
          this._parserService.parseAndUpdateText(
            title || '',
            config,
            allProjects,
            allTags,
            defaultProject!,
            date,
            time,
          );
        },
      );
  }

  private _setupSuggestions(): void {
    this.suggestions$ = this._addTaskBarIssueSearchService.getFilteredIssueSuggestions$(
      this.stateService.inputTxt$,
      this._isSearchIssueProviders$,
      this.isSearchLoading,
    );

    // Auto-activate first suggestion when autoActiveFirstOption is true
    this.suggestions$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((suggestions) => {
        if (suggestions && suggestions.length > 0) {
          this.onTaskSuggestionActivated(suggestions[0]);
        } else {
          this.onTaskSuggestionActivated(null);
        }
      });
  }

  // Public methods
  async addTask(): Promise<void> {
    if (this._processingAutocompleteSelection) {
      return;
    }

    const autocomplete = this.taskAutoCompleteEl();
    if (
      autocomplete &&
      autocomplete.isOpen &&
      autocomplete.options &&
      autocomplete.options.length > 0
    ) {
      return;
    }

    const currentState = this.stateService.state();
    const title = currentState.cleanText || this.stateService.inputTxt().trim();
    if (!title) return;

    const state = this.stateService.state();
    let finalTagIds = [...state.tagIds, ...state.tagIdsFromTxt];

    if (this.hasNewTags()) {
      const shouldCreateNewTags = await this._confirmNewTags();
      if (shouldCreateNewTags) {
        const newTagIds = await this._createNewTags(state.newTagTitles);
        finalTagIds = [...finalTagIds, ...newTagIds];
      }
    }

    // Filter out tags to remove if specified
    const tagsToRemoveList = this.tagsToRemove();
    if (tagsToRemoveList && tagsToRemoveList.length > 0) {
      finalTagIds = finalTagIds.filter((tagId) => !tagsToRemoveList.includes(tagId));
    }

    const additionalFields = this.additionalFields();
    const taskData: Partial<TaskCopy> = {
      ...additionalFields,
      projectId: state.projectId,
      tagIds: additionalFields?.tagIds
        ? unique([...finalTagIds, ...additionalFields.tagIds])
        : finalTagIds,
      // needs to be 0
      timeEstimate: state.estimate || 0,
    };

    if (state.spent) {
      taskData.timeSpentOnDay = state.spent;
    }

    if (state.date) {
      // Parse date components to create date in local timezone
      // This avoids timezone issues when parsing date strings like "2024-01-15"
      const [year, month, day] = state.date.split('-').map(Number);
      const date = new Date(year, month - 1, day);

      if (state.time) {
        // TODO we need to add unit tests to confirm this works
        const [hours, minutes] = state.time.split(':').map(Number);
        date.setHours(hours, minutes, 0, 0);
        taskData.dueWithTime = date.getTime();
        taskData.hasPlannedTime = true;
      } else {
        taskData.dueDay = state.date;
      }
    } else {
      // Explicitly set dueDay to undefined when no date is selected
      // This prevents automatic assignment of today's date in TODAY context
      taskData.dueDay = undefined;
    }

    Log.x(taskData);

    const taskId = this._taskService.add(
      title,
      this.isAddToBacklog(),
      taskData,
      this.isAddToBottom(),
    );

    if (taskData.dueWithTime) {
      this._taskService
        .getByIdOnce$(taskId)
        .pipe(timeout(1000))
        .subscribe((task) => {
          this._taskService.scheduleTask(
            task,
            taskData.dueWithTime!,
            state.remindOption ??
              this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
              DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
            this.isAddToBacklog(),
          );
        });
    }

    this.afterTaskAdd.emit({ taskId, isAddToBottom: this.isAddToBottom() });
    this._resetAfterAdd();
  }

  onTaskSuggestionActivated(suggestion: AddTaskSuggestion | null): void {
    this.activatedSuggestion$.next(suggestion);
  }

  async onTaskSuggestionSelected(suggestion: AddTaskSuggestion): Promise<void> {
    if (!suggestion) return;

    this._processingAutocompleteSelection = true;

    if (this._autocompleteTimeout) {
      window.clearTimeout(this._autocompleteTimeout);
    }

    this._autocompleteTimeout = window.setTimeout(() => {
      this._processingAutocompleteSelection = false;
    }, 100);

    let taskId: string | undefined;

    const planForDay = this.planForDay();
    let didPlanForDay = false;

    if (suggestion.taskId && suggestion.isFromOtherContextAndTagOnlySearch) {
      if (planForDay) {
        await this._planTaskForCurrentDay(suggestion.taskId);
        didPlanForDay = true;
      } else if (this._workContextService.activeWorkContextType === WorkContextType.TAG) {
        const task = await this._taskService.getByIdOnce$(suggestion.taskId).toPromise();
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
        await this._planTaskForCurrentDay(suggestion.taskId);
        didPlanForDay = true;
      } else {
        this._taskService.getByIdOnce$(suggestion.taskId).subscribe((task) => {
          this._taskService.moveToCurrentWorkContext(task);
        });
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
        this.isAddToBacklog(),
        true,
      );
    }

    if (taskId && planForDay && !didPlanForDay) {
      await this._planTaskForCurrentDay(taskId);
      didPlanForDay = true;
    }

    if (taskId) {
      this.afterTaskAdd.emit({
        taskId,
        isAddToBottom: false,
      });
    }

    window.setTimeout(() => {
      this.stateService.updateInputTxt('');
      this.activatedSuggestion$.next(null);
    });
  }

  // UI event handlers
  onInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = target.value;
    this.stateService.updateInputTxt(value);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const component = target.closest('add-task-bar');
    const overlayContainer = target.closest('.cdk-overlay-container');

    // If click is outside the component and not on autocomplete or menu options, close it
    if (!component && !overlayContainer && !this.isScheduleDialogOpen()) {
      this.done.emit();
    }
  }

  toggleIsAddToBottom(): void {
    this.isAddToBottom.update((v) => !v);
    localStorage.setItem(LS.IS_ADD_TO_BOTTOM, JSON.stringify(this.isAddToBottom()));
    this.focusInput();
  }

  toggleIsAddToBacklog(): void {
    this.isAddToBacklog.update((v) => !v);
    this.focusInput();
  }

  toggleSearchMode(): void {
    this.isSearchMode.update((mode) => !mode);
    this.focusInput();
  }

  onInputKeydown(event: KeyboardEvent): void {
    // Early return if mention popup is handling the key
    if (this._shouldMentionHandleKey(event)) {
      return;
    }

    // Handle Escape key
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
      return;
    }

    // Handle Enter key
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!this.isSearchMode()) {
        void this.addTask();
      }
      return;
    }

    // Handle Ctrl+Number shortcuts
    if (event.ctrlKey) {
      this._handleCtrlShortcut(event);
    }
  }

  private _shouldMentionHandleKey(event: KeyboardEvent): boolean {
    const mentionHandledKeys = ['Escape', 'Enter'];
    return mentionHandledKeys.includes(event.key) && this.isMentionListShown();
  }

  private _handleCtrlShortcut(event: KeyboardEvent): void {
    const shortcutMap: Record<string, () => void> = {
      ['1']: () => this.toggleIsAddToBottom(),
      ['2']: () => this.toggleSearchMode(),
      ['3']: () => this._callActionMethod('openProjectMenu'),
      ['4']: () => this._callActionMethod('openScheduleDialog'),
      ['5']: () => this._callActionMethod('openTagsMenu'),
      ['6']: () => this._callActionMethod('openEstimateMenu'),
    };

    const action = shortcutMap[event.key];
    if (action) {
      event.preventDefault();
      // Add stopPropagation for action menu shortcuts (3-6)
      if (['3', '4', '5', '6'].includes(event.key)) {
        event.stopPropagation();
      }
      action();
    }
  }

  private _callActionMethod(methodName: keyof AddTaskBarActionsComponent): void {
    const actionsComp = this.actionsComponent();
    if (actionsComp) {
      (actionsComp[methodName] as () => void)();
    }
  }

  // Private helper methods
  private async _planTaskForCurrentDay(taskId: string): Promise<void> {
    const planForDay = this.planForDay();
    if (!planForDay) {
      return;
    }

    const task = await this._taskService.getByIdOnce$(taskId).toPromise();
    if (!task) {
      Log.error('Unable to load task for planning', taskId);
      return;
    }

    this._store.dispatch(
      PlannerActions.planTaskForDay({
        task,
        day: planForDay,
        isAddToTop: !this.isAddToBottom(),
      }),
    );
  }

  private async _confirmNewTags(): Promise<boolean> {
    const dialogRef = this._matDialog.open(DialogConfirmComponent, {
      data: {
        message: `${this._translateService.instant(T.F.TASK.ADD_TASK_BAR.CREATE_NEW_TAGS)}: ${this.stateService.state().newTagTitles.join(', ')}?`,
      },
    });
    return await dialogRef.afterClosed().toPromise();
  }

  private async _createNewTags(tagTitles: string[]): Promise<string[]> {
    const newTagIds: string[] = [];
    for (const title of tagTitles) {
      const tagId = this._tagService.addTag({ title });
      newTagIds.push(tagId);
    }
    return newTagIds;
  }

  private _resetAfterAdd(): void {
    this.stateService.resetAfterAdd();
    // Reset parser state but don't reset project/date/estimate
    this._parserService.resetPreviousResult();
  }

  focusInput(selectAll: boolean = false): void {
    // Cancel any existing timeout
    if (this._focusTimeout !== undefined) {
      window.clearTimeout(this._focusTimeout);
    }

    document.body.focus();
    this.inputEl()?.nativeElement.focus();
    window.setTimeout(() => this.inputEl()?.nativeElement.focus());

    // Set new timeout
    if (IS_ANDROID_WEB_VIEW) {
      this._focusTimeout = window.setTimeout(() => {
        document.body.focus();
        this.inputEl()?.nativeElement.focus();
        if (selectAll) {
          this.inputEl()?.nativeElement.select();
        }
        this._focusTimeout = undefined;
      }, 200);
    } else {
      this._focusTimeout = window.setTimeout(() => {
        const inputElement = this.inputEl()?.nativeElement;
        if (inputElement) {
          inputElement.focus();
          if (selectAll) {
            inputElement.select();
          }
        }
      }, 50);
    }
  }

  updateListShown(isShown: boolean): void {
    window.setTimeout(() => this.isMentionListShown.set(isShown));
  }

  onScheduleDialogOpenChange(isOpen: boolean): void {
    this.isScheduleDialogOpen.set(isOpen);
  }
}
