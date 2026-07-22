import {
  afterRenderEffect,
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
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { MentionModule } from '../../../ui/mentions';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { LS } from '../../../core/persistence/storage-keys.const';
import { blendInOutAnimation } from 'src/app/ui/animations/blend-in-out.ani';
import { expandFadeAnimation } from '../../../ui/animations/expand.ani';
import { TaskCopy, TaskReminderOptionId } from '../task.model';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContext, WorkContextType } from '../../work-context/work-context.model';
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
  switchMap,
  timeout,
  withLatestFrom,
} from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { BehaviorSubject, combineLatest, from, Observable } from 'rxjs';
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
import { ShortSyntaxSegment, splitTextByRanges } from '../short-syntax-ranges';
import { AddTaskBarActionsComponent } from './add-task-bar-actions/add-task-bar-actions.component';
import { MarkdownPasteService } from '../markdown-paste.service';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { unique } from '../../../util/unique';
import { MentionConfigService } from '../mention-config.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { DEFAULT_TASK_REPEAT_CFG } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getQuickSettingUpdates } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-quick-setting-updates';
import { getDefaultSkipOverdue } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-default-skip-overdue';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ShortSyntaxTag, shortSyntaxToTags } from './short-syntax-to-tags';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { Log } from '../../../core/log';
import { TODAY_TAG } from '../../tag/tag.const';
import { BodyClass } from '../../../app.constants';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { Store } from '@ngrx/store';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DateService } from '../../../core/date/date.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';

@Component({
  selector: 'add-task-bar',
  templateUrl: './add-task-bar.component.html',
  styleUrls: ['./add-task-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [blendInOutAnimation, expandFadeAnimation],
  standalone: true,
  imports: [
    FormsModule,
    CdkTextareaAutosize,
    MatIconButton,
    MatIcon,
    MatTooltip,
    AsyncPipe,
    NgTemplateOutlet,
    MentionModule,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    MatProgressSpinner,
    IssueIconPipe,
    TagComponent,
    AddTaskBarActionsComponent,
    TranslateModule,
    SelectOptionRowComponent,
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
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _markdownPasteService = inject(MarkdownPasteService);
  private readonly _dateService = inject(DateService);
  private readonly _menuTreeService = inject(MenuTreeService);
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

  // Computed signals for projects and tags
  projects = this._projectService.listInTreeOrderForUI;
  // Observable version for compatibility with existing code
  projects$ = toObservable(this.projects);
  tags$ = this._tagService.tags$;
  suggestions$!: Observable<AddTaskSuggestion[]>;
  activatedIssueTask = toSignal(this.activatedSuggestion$, { initialValue: null });

  // Computed values
  projectFolderMap = computed(() => this._menuTreeService.projectFolderMap());
  tagFolderMap = computed(() => this._menuTreeService.tagFolderMap());

  getFolderPath(id?: string): string | null {
    if (!id) return null;
    return this.projectFolderMap().get(id) || this.tagFolderMap().get(id) || null;
  }

  hasNewTags = computed(() => this.stateService.state().newTagTitles.length > 0);
  currentProject = computed(() =>
    this.projects().find((p) => p.id === this.stateService.state().projectId),
  );
  // The submit (+) button is always in the layout so its space is reserved; it
  // is only visually shown while composing a task (hidden via visibility, not
  // display, so the input width never jumps).
  isSubmitVisible = computed(
    () => !this.isSearchMode() && this.stateService.inputTxt().length > 0,
  );

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
            date: this._dateService.todayStr(),
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
    switchMap(([val, tags, projects, activeWorkContext, shortSyntaxConfig]) =>
      from(
        shortSyntaxToTags({
          val,
          tags,
          projects,
          defaultColor: activeWorkContext?.theme?.primary || DEFAULT_PROJECT_COLOR,
          shortSyntaxConfig,
        }),
      ),
    ),
    startWith([]),
  );

  mentionCfg$ = inject(MentionConfigService).mentionConfig$;

  // View children
  inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('inputEl');
  noteEl = viewChild<ElementRef<HTMLTextAreaElement>>('noteEl');
  highlightEl = viewChild<ElementRef<HTMLElement>>('highlightEl');
  taskAutoCompleteEl = viewChild<MatAutocomplete>('taskAutoCompleteEl');
  actionsComponent = viewChild(AddTaskBarActionsComponent);

  // Segments of the raw input for the highlight overlay behind the textarea.
  // Ranges are pinned to the text they were parsed from (the parse is async),
  // so they are only ever applied to that exact text or to the part of a newer
  // text they cannot have moved in.
  highlightSegments = computed<ShortSyntaxSegment[]>(() => {
    const txt = this.stateService.inputTxt();
    if (!txt || this.isSearchMode()) {
      return [];
    }
    const highlight = this.stateService.syntaxHighlight();
    if (!highlight || highlight.ranges.length === 0) {
      return [{ text: txt, type: null }];
    }
    if (highlight.forText === txt) {
      return splitTextByRanges(txt, highlight.ranges);
    }
    // The parse is async, so every keystroke renders once with ranges from the
    // previous text. Dropping them all blanks the highlights for a frame
    // (visible flicker), so keep the ones the edit cannot have moved: those
    // that end inside the unchanged common prefix. A highlight is then never
    // mispositioned, only at most one keystroke stale.
    let common = 0;
    const max = Math.min(highlight.forText.length, txt.length);
    while (common < max && highlight.forText[common] === txt[common]) {
      common++;
    }
    const stillValid = highlight.ranges.filter((r) => r.end <= common);
    return stillValid.length
      ? splitTextByRanges(txt, stillValid)
      : [{ text: txt, type: null }];
  });

  // The overlay must track the textarea's scroll position (cdkTextareaAutosize
  // caps growth at 4 rows, after which the field scrolls)
  syncHighlightScroll(): void {
    const inputElement = this.inputEl()?.nativeElement;
    const overlay = this.highlightEl()?.nativeElement;
    if (inputElement && overlay) {
      overlay.scrollTop = inputElement.scrollTop;
    }
  }

  // Once the field scrolls, the textarea's caret-scroll happens before the
  // overlay re-renders, so the (scroll)-listener alone would clamp against
  // still-short overlay content — re-sync after each segments render.
  private readonly _overlayScrollSyncEffect = afterRenderEffect(() => {
    this.highlightSegments();
    this.syncHighlightScroll();
  });

  private _focusTimeout?: number;
  private _autocompleteTimeout?: number;
  private _processingAutocompleteSelection = false;
  private _isAddingTask = false;
  private _defaultTagIds: string[] = [];

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
    const additionalProjectId = this.additionalFields()?.projectId;
    if (additionalProjectId) {
      this.stateService.updateProjectId(additionalProjectId);
      return;
    }
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
        this._defaultTagIds = this._getDefaultTagIdsForWorkContext(workContext);
        if (this._defaultTagIds.length > 0) {
          this.stateService.updateTagIds(this._defaultTagIds);
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
      .pipe(
        switchMap(
          ([title, config, allTags, allProjects, defaultProject, defaultDateInfo]) => {
            const { date, time } = defaultDateInfo;
            return from(
              this._parserService.parseAndUpdateText(
                title || '',
                config,
                allProjects,
                allTags,
                defaultProject!,
                date,
                time,
              ),
            );
          },
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe();
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
    if (this._processingAutocompleteSelection || this._isAddingTask) {
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
    const rawInput = this.stateService.inputTxt().trim();
    if (!rawInput) return;

    const title = currentState.cleanText || rawInput;
    if (!title) return;

    this._isAddingTask = true;
    try {
      const state = currentState;
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
        attachments:
          state.attachments.length > 0
            ? state.attachments
            : additionalFields?.attachments || [],
      };

      const note = this.stateService.noteTxt().trim();
      if (note) {
        taskData.notes = note;
      }

      if (state.spent) {
        taskData.timeSpentOnDay = state.spent;
      }

      if (state.deadlineDate) {
        if (state.deadlineTime && isValidSplitTime(state.deadlineTime)) {
          const deadlineDateObj = dateStrToUtcDate(state.deadlineDate);
          const deadlineTimestamp = getDateTimeFromClockString(
            state.deadlineTime,
            deadlineDateObj,
          );
          taskData.deadlineWithTime = deadlineTimestamp;
          if (
            state.deadlineRemindOption &&
            state.deadlineRemindOption !== TaskReminderOptionId.DoNotRemind
          ) {
            taskData.deadlineRemindAt = remindOptionToMilliseconds(
              deadlineTimestamp,
              state.deadlineRemindOption,
            );
          }
        } else {
          taskData.deadlineDay = state.deadlineDate;
        }
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
      } else if (state.repeatQuickSetting && state.repeatQuickSetting !== 'CUSTOM') {
        // When a repeat preset is selected without an explicit date, set dueDay to today
        // so the first task instance appears as today's occurrence instead of staying in inbox
        taskData.dueDay = this._dateService.todayStr();
      } else {
        // Explicitly set dueDay to undefined when no date is selected
        // This prevents automatic assignment of today's date in TODAY context
        taskData.dueDay = undefined;
      }

      const taskId = this._taskService.add(
        title,
        this.isAddToBacklog(),
        taskData,
        this.isAddToBottom(),
      );

      // Resolve remind option once for both scheduleTask and repeat config paths
      const resolvedRemindOption =
        state.remindOption ??
        this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
        DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;

      // Skip scheduleTask for timed repeat tasks — the addRepeatCfgToTaskUpdateTask$
      // effect already handles scheduling via scheduleTaskWithTime, so calling both
      // would cause double-scheduling.
      const isTimedRepeatTask =
        !!state.repeatQuickSetting &&
        state.repeatQuickSetting !== 'CUSTOM' &&
        !!state.time;
      if (taskData.dueWithTime && !isTimedRepeatTask) {
        this._taskService
          .getByIdOnce$(taskId)
          .pipe(timeout(1000))
          .subscribe((task) => {
            this._taskService.scheduleTask(
              task,
              taskData.dueWithTime!,
              resolvedRemindOption,
              this.isAddToBacklog(),
            );
          });
      }

      // Create repeat config if a repeat setting was selected
      if (state.repeatQuickSetting) {
        if (state.repeatQuickSetting === 'CUSTOM') {
          this._openRepeatDialogForTask(taskId, resolvedRemindOption);
        } else {
          const startDate = state.date || this._dateService.todayStr();
          const referenceDate = dateStrToUtcDate(startDate);
          const quickSettingUpdates =
            getQuickSettingUpdates(state.repeatQuickSetting, referenceDate) || {};
          const newRepeatCfg = {
            ...DEFAULT_TASK_REPEAT_CFG,
            startDate,
            ...quickSettingUpdates,
            title,
            quickSetting: state.repeatQuickSetting,
            notes: taskData.notes,
            tagIds: taskData.tagIds ?? [],
            defaultEstimate: state.estimate || 0,
            startTime: state.time || undefined,
            remindAt: state.time ? resolvedRemindOption : undefined,
          };
          // Seed the skipOverdue default from the chosen schedule, same as the
          // repeat dialog (there is no advanced toggle in the inline add-bar).
          this._taskRepeatCfgService.addTaskRepeatCfgToTask(taskId, state.projectId, {
            ...newRepeatCfg,
            skipOverdue: getDefaultSkipOverdue(newRepeatCfg),
          });
        }
      }

      this.afterTaskAdd.emit({ taskId, isAddToBottom: this.isAddToBottom() });
      this._resetAfterAdd();
    } finally {
      this._isAddingTask = false;
    }
  }

  onSubmitBtnClick(): void {
    // Clicking the + button moves focus onto the button, which then vanishes
    // once the input clears — refocus the input so the next task can be typed
    // right away. (The Enter-key submit path never loses input focus.)
    // Skip the refocus for CUSTOM repeat: addTask() opens the repeat-config
    // dialog asynchronously, and refocusing would steal focus from it.
    const willOpenRepeatDialog =
      this.stateService.state().repeatQuickSetting === 'CUSTOM';
    void this.addTask().finally(() => {
      if (!willOpenRepeatDialog) {
        this.focusInput();
      }
    });
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
    const target = event.target as HTMLTextAreaElement;
    // The title is single-line even though the field is now an auto-growing
    // textarea (so long titles wrap). Enter submits, but a paste can still carry
    // newlines — collapse them to spaces before they reach the parsed state.
    const value = target.value.replace(/[\r\n]+/g, ' ');
    if (value !== target.value) {
      target.value = value;
    }
    this.stateService.updateInputTxt(value);
  }

  onPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData('text/plain');
    if (!pastedText) return;

    // Only intercept multi-line pastes to avoid disrupting normal single-line task entry
    const lines = pastedText.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) return;

    if (!this._markdownPasteService.isMarkdownTaskList(pastedText)) return;

    event.preventDefault();
    this._markdownPasteService.handleMarkdownPaste(pastedText, null).then(() => {
      this.stateService.updateInputTxt('');
    });
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
      // Progressive dismissal: if the task-suggestion panel is open, let Material
      // close it first instead of tearing down the whole bar.
      if (this.taskAutoCompleteEl()?.isOpen) {
        return;
      }
      event.preventDefault();
      this.closed.emit();
      return;
    }

    // Ctrl/Cmd+Enter reveals the note field instead of submitting, so a note
    // can be added without leaving the keyboard.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      this.expandNote();
      return;
    }

    // Handle Enter key
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!this.isSearchMode() && !event.repeat) {
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
    // Numbers 1-3 match the left-to-right order of the icon toggles below the
    // input (search · note · add-to-top/bottom); these are local and harmless to
    // let bubble.
    const localToggles: Record<string, () => void> = {
      ['1']: () => this.toggleSearchMode(),
      ['2']: () => this.toggleNote(),
      ['3']: () => this.toggleIsAddToBottom(),
    };
    // 4-9 open the action chips' menus/dialogs; stop propagation so the keystroke
    // doesn't also reach a global handler.
    const actionShortcuts: Record<string, () => void> = {
      ['4']: () => this._callActionMethod('openProjectMenu'),
      ['5']: () => this._callActionMethod('openScheduleDialog'),
      ['6']: () => this._callActionMethod('openTagsMenu'),
      ['7']: () => this._callActionMethod('openEstimateMenu'),
      ['8']: () => this._callActionMethod('openRepeatMenu'),
      ['9']: () => this._callActionMethod('openDeadlineDialog'),
    };

    const localToggle = localToggles[event.key];
    const actionShortcut = actionShortcuts[event.key];
    if (localToggle) {
      event.preventDefault();
      localToggle();
    } else if (actionShortcut) {
      event.preventDefault();
      event.stopPropagation();
      actionShortcut();
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

  private _openRepeatDialogForTask(
    taskId: string,
    remindOption: TaskReminderOptionId,
  ): void {
    this._taskService
      .getByIdOnce$(taskId)
      .pipe(timeout(1000), takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: async (task) => {
          const { DialogEditTaskRepeatCfgComponent } =
            await import('../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component');
          this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
            data: { task, defaultRemindOption: remindOption },
          });
        },
        error: (err) => {
          Log.error('Failed to open repeat dialog', err);
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.TASK_REPEAT.SNACK_REPEAT_DIALOG_FAIL,
          });
        },
      });
  }

  private _resetAfterAdd(): void {
    this.stateService.resetAfterAdd();
    if (this._defaultTagIds.length > 0) {
      this.stateService.updateTagIds(this._defaultTagIds);
    }
    // Reset parser state but don't reset project/date/estimate
    this._parserService.resetPreviousResult();
  }

  private _getDefaultTagIdsForWorkContext(
    workContext: WorkContext | null | undefined,
  ): string[] {
    return !this.isNoDefaults() &&
      workContext?.type === WorkContextType.TAG &&
      workContext.id !== TODAY_TAG.id
      ? [workContext.id]
      : [];
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

  toggleNote(): void {
    // The note field only renders in create mode, so the toggle (incl. its
    // Ctrl+2 shortcut) is a no-op while searching.
    if (this.isSearchMode()) {
      return;
    }
    const willExpand = !this.stateService.isNoteExpanded();
    this.stateService.isNoteExpanded.set(willExpand);
    if (willExpand) {
      this._focusNote();
    } else {
      this.focusInput();
    }
  }

  expandNote(): void {
    // The note field only renders in create mode; guard like toggleNote() so
    // Ctrl+Enter while searching cannot leave isNoteExpanded stuck on.
    if (this.isSearchMode()) {
      return;
    }
    this.stateService.isNoteExpanded.set(true);
    this._focusNote();
  }

  onNoteKeydown(event: KeyboardEvent): void {
    // Ctrl/Cmd+Enter submits from the note field; plain Enter inserts a newline.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      void this.addTask();
      return;
    }

    // Escape collapses the note and returns focus to the title without
    // closing the whole bar (a second Escape on the title closes it).
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.stateService.isNoteExpanded.set(false);
      this.focusInput();
    }
  }

  private _focusNote(): void {
    // Defer so the textarea has been rendered by the `@if` before focusing.
    window.setTimeout(() => this.noteEl()?.nativeElement.focus());
  }

  updateListShown(isShown: boolean): void {
    window.setTimeout(() => this.isMentionListShown.set(isShown));
  }

  onScheduleDialogOpenChange(isOpen: boolean): void {
    this.isScheduleDialogOpen.set(isOpen);
  }
}
