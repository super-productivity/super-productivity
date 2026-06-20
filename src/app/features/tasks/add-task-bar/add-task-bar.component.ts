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
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { MentionModule } from '../../../ui/mentions';
import { MatInput } from '@angular/material/input';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { AsyncPipe } from '@angular/common';
import { LS } from '../../../core/persistence/storage-keys.const';
import { blendInOutAnimation } from 'src/app/ui/animations/blend-in-out.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { TaskCopy } from '../task.model';
import { WorkContext, WorkContextType } from '../../work-context/work-context.model';
import { T } from '../../../t.const';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  startWith,
  switchMap,
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
import { TagComponent } from '../../tag/tag/tag.component';
import { AddTaskBarStateService } from './add-task-bar-state.service';
import { AddTaskBarParserService } from './add-task-bar-parser.service';
import { AddTaskBarActionsComponent } from './add-task-bar-actions/add-task-bar-actions.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ShortSyntaxTag, shortSyntaxToTags } from './short-syntax-to-tags';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { TODAY_TAG } from '../../tag/tag.const';
import { BodyClass } from '../../../app.constants';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import { buildAddTaskPayload } from './add-task-payload-builder';
import { ADD_TASK_BAR_DATA_FACADE } from './add-task-bar-data-facade.token';

@Component({
  selector: 'add-task-bar',
  templateUrl: './add-task-bar.component.html',
  styleUrls: ['./add-task-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [blendInOutAnimation, fadeAnimation],
  standalone: true,
  imports: [
    FormsModule,
    CdkTextareaAutosize,
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
    TagComponent,
    AddTaskBarActionsComponent,
    TranslateModule,
    SelectOptionRowComponent,
  ],
  providers: [AddTaskBarStateService, AddTaskBarParserService],
})
export class AddTaskBarComponent implements AfterViewInit, OnInit, OnDestroy {
  private readonly _dataFacade = inject(ADD_TASK_BAR_DATA_FACADE);
  private readonly _matDialog = inject(MatDialog);
  private readonly _parserService = inject(AddTaskBarParserService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _translateService = inject(TranslateService);
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
  projects = this._dataFacade.projects;
  // Observable version for compatibility with existing code
  projects$ = this._dataFacade.projects$;
  tags$ = this._dataFacade.tags$;
  suggestions$!: Observable<AddTaskSuggestion[]>;
  activatedIssueTask = toSignal(this.activatedSuggestion$, { initialValue: null });

  // Computed values
  projectFolderMap = this._dataFacade.projectFolderMap;
  tagFolderMap = this._dataFacade.tagFolderMap;

  getFolderPath(id?: string): string | null {
    if (!id) return null;
    return this.projectFolderMap().get(id) || this.tagFolderMap().get(id) || null;
  }

  getIssueIcon(issueType: AddTaskSuggestion['issueType']): string | undefined {
    return this._dataFacade.getIssueIcon(issueType);
  }

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
    this._dataFacade.activeWorkContext$,
    this._dataFacade.tasksConfig$,
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

  defaultDateAndTime$ = this._dataFacade.activeWorkContext$.pipe(
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
            date: this._dataFacade.todayStr(),
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
      this._dataFacade.tagsNoMyDayAndNoListSorted$,
      this.projects$,
      this._dataFacade.activeWorkContext$,
      this._dataFacade.shortSyntax$,
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

  mentionCfg$ = this._dataFacade.mentionConfig$;

  // View children
  inputEl = viewChild<ElementRef>('inputEl');
  noteEl = viewChild<ElementRef<HTMLTextAreaElement>>('noteEl');
  taskAutoCompleteEl = viewChild<MatAutocomplete>('taskAutoCompleteEl');
  actionsComponent = viewChild(AddTaskBarActionsComponent);

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
    this._setupHudWindowLifecycle();

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

    this._dataFacade.activeWorkContext$
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
      this._dataFacade.shortSyntax$,
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
    this.suggestions$ = this._dataFacade.getFilteredIssueSuggestions$(
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

  private _setupHudWindowLifecycle(): void {
    const unsubscribeQuickAddOpened = this._dataFacade.onHudOpened(() => {
      this.stateService.collapseTransientPanels();
      this.focusInput(true);
    });
    this._destroyRef.onDestroy(unsubscribeQuickAddOpened);
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
      let newTagTitles: string[] | undefined;

      if (this.hasNewTags()) {
        const shouldCreateNewTags = await this._confirmNewTags();
        if (shouldCreateNewTags) {
          if (this._dataFacade.isSubmitDelegated) {
            newTagTitles = state.newTagTitles;
          } else {
            const newTagIds = await this._dataFacade.createNewTags(state.newTagTitles);
            finalTagIds = [...finalTagIds, ...newTagIds];
          }
        }
      }

      // Filter out tags to remove if specified
      const tagsToRemoveList = this.tagsToRemove();
      if (tagsToRemoveList && tagsToRemoveList.length > 0) {
        finalTagIds = finalTagIds.filter((tagId) => !tagsToRemoveList.includes(tagId));
      }

      const defaultRemindOption =
        state.remindOption ?? this._dataFacade.defaultTaskRemindOption();
      const taskId = await this._dataFacade.submitTask(
        buildAddTaskPayload({
          title,
          state,
          note: this.stateService.noteTxt().trim(),
          isAddToBacklog: this.isAddToBacklog(),
          isAddToBottom: this.isAddToBottom(),
          todayStr: this._dataFacade.todayStr(),
          defaultRemindOption,
          finalTagIds,
          additionalFields: this.additionalFields(),
          newTagTitles,
        }),
      );

      this.afterTaskAdd.emit({ taskId, isAddToBottom: this.isAddToBottom() });
      this._resetAfterAdd();
    } finally {
      this._isAddingTask = false;
    }
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

    const planForDay = this.planForDay();
    const result = await this._dataFacade.handleSuggestionSelected(
      suggestion,
      planForDay,
      this.isAddToBacklog(),
      this.isAddToBottom(),
    );

    if (result) {
      this.afterTaskAdd.emit({
        taskId: result.taskId,
        isAddToBottom: result.isAddToBottom,
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

  onPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData('text/plain');
    if (!pastedText) return;

    // Only intercept multi-line pastes to avoid disrupting normal single-line task entry
    const lines = pastedText.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) return;

    if (!this._dataFacade.isMarkdownTaskList(pastedText)) return;

    event.preventDefault();
    this._dataFacade.handleMarkdownPaste(pastedText).then(() => {
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
    const shortcutMap: Record<string, () => void> = {
      ['1']: () => this.toggleIsAddToBottom(),
      ['2']: () => this.toggleSearchMode(),
      ['3']: () => this._callActionMethod('openProjectMenu'),
      ['4']: () => this._callActionMethod('openScheduleDialog'),
      ['5']: () => this._callActionMethod('openTagsMenu'),
      ['6']: () => this._callActionMethod('openEstimateMenu'),
      ['7']: () => this._callActionMethod('openRepeatMenu'),
      ['8']: () => this._callActionMethod('openDeadlineDialog'),
    };

    const action = shortcutMap[event.key];
    if (action) {
      event.preventDefault();
      // Add stopPropagation for action menu shortcuts (3-8)
      if (['3', '4', '5', '6', '7', '8'].includes(event.key)) {
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

  private async _confirmNewTags(): Promise<boolean> {
    const dialogRef = this._matDialog.open(DialogConfirmComponent, {
      data: {
        message: `${this._translateService.instant(T.F.TASK.ADD_TASK_BAR.CREATE_NEW_TAGS)}: ${this.stateService.state().newTagTitles.join(', ')}?`,
      },
    });
    return await dialogRef.afterClosed().toPromise();
  }

  private _resetAfterAdd(): void {
    this.stateService.resetAfterAdd({
      isCollapseNote: this._dataFacade.isSubmitDelegated,
    });
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
    const willExpand = !this.stateService.isNoteExpanded();
    this.stateService.isNoteExpanded.set(willExpand);
    if (willExpand) {
      this._focusNote();
    } else {
      this.focusInput();
    }
  }

  expandNote(): void {
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
