import { computed, Injectable, WritableSignal, signal, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import type { Project } from '../../project/project.model';
import type { Tag } from '../../tag/tag.model';
import type { WorkContext } from '../../work-context/work-context.model';
import type { TasksConfig, ShortSyntaxConfig } from '../../config/global-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { TaskReminderOptionId } from '../task.model';
import { AddTaskSuggestion } from './add-task-suggestions.model';
import { AddTaskPayload } from './add-task-payload-builder';
import {
  AddTaskBarDataFacade,
  AddTaskBarSuggestionResult,
} from './add-task-bar-data-facade.token';
import {
  QuickAddHudProject,
  QuickAddHudSnapshot,
  QuickAddHudTag,
  QuickAddHudWorkContext,
} from './quick-add-hud.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import type { MentionConfig, Mentions } from '../../../ui/mentions/mention-config';
import type { MentionItem } from '../../../ui/mentions/mention-types';
import { CHRONO_SUGGESTIONS } from './add-task-bar.const';
import { DEFAULT_PROJECT, DEFAULT_PROJECT_ICON } from '../../project/project.const';
import { DEFAULT_TAG } from '../../tag/tag.const';
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
  WORK_CONTEXT_DEFAULT_COMMON,
} from '../../work-context/work-context.const';
import { isSingleEmoji } from '../../../util/extract-first-emoji';

const DEFAULT_SHORT_SYNTAX: ShortSyntaxConfig = {
  isEnableProject: true,
  isEnableDue: true,
  isEnableTag: true,
};

const EMPTY_TASKS_CONFIG: TasksConfig = {
  isAutoMarkParentAsDone: false,
  isAutoAddWorkedOnToToday: false,
  isTrayShowCurrent: false,
  isMarkdownFormattingInNotesEnabled: true,
  notesTemplate: '',
  defaultProjectId: null,
};

@Injectable()
export class QuickAddHudDataFacadeService implements AddTaskBarDataFacade {
  readonly isSubmitDelegated = true;

  private readonly _snapshot = signal<QuickAddHudSnapshot | null>(null);
  private readonly _activeWorkContext$ = new BehaviorSubject<WorkContext | null>(null);
  private readonly _tasksConfig$ = new BehaviorSubject<TasksConfig>(EMPTY_TASKS_CONFIG);
  private readonly _shortSyntax$ = new BehaviorSubject<ShortSyntaxConfig>(
    DEFAULT_SHORT_SYNTAX,
  );
  private readonly _mentionConfig$ = new BehaviorSubject<MentionConfig>({
    mentions: [],
    triggerChar: undefined,
  });
  private readonly _htmlClasses = new Set<string>();
  private readonly _bodyClasses = new Set<string>();
  private readonly _htmlCssVars = new Map<string, string>();
  private readonly _bodyCssVars = new Map<string, string>();
  private readonly _translateService = inject(TranslateService);

  readonly projects = computed<Project[]>(() =>
    (this._snapshot()?.projects ?? []).map(_toProject),
  );
  readonly isReady = computed(() => !!this._snapshot());
  readonly projects$ = _signalToObservable(this.projects);
  readonly tagsNoMyDayAndNoListInTreeOrder = computed<Tag[]>(() =>
    (this._snapshot()?.tags ?? []).map(_toTag),
  );
  readonly tags$ = _signalToObservable(this.tagsNoMyDayAndNoListInTreeOrder);
  readonly tagsNoMyDayAndNoListSorted$ = this.tags$;
  readonly activeWorkContext$ = this._activeWorkContext$.asObservable();
  readonly tasksConfig$ = this._tasksConfig$.asObservable();
  readonly shortSyntax$ = this._shortSyntax$.asObservable();
  readonly mentionConfig$ = this._mentionConfig$.asObservable();
  readonly projectFolderMap = computed(
    () => new Map(Object.entries(this._snapshot()?.folderPaths.projects ?? {})),
  );
  readonly tagFolderMap = computed(
    () => new Map(Object.entries(this._snapshot()?.folderPaths.tags ?? {})),
  );

  constructor() {
    void this.refreshSnapshot();
  }

  defaultTaskRemindOption(): TaskReminderOptionId {
    return (
      this._snapshot()?.defaultTaskRemindOption ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!
    );
  }

  todayStr(): string {
    return this._snapshot()?.todayStr ?? getDbDateStr(new Date());
  }

  getLogicalTodayDate(): Date {
    const [year, month, day] = this.todayStr().split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  currentLocale(): string {
    return this._snapshot()?.dateTimeLocale || 'en-US';
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString(this.currentLocale(), {
      hour: 'numeric',
      minute: 'numeric',
    });
  }

  async submitTask(payload: AddTaskPayload): Promise<string> {
    const result = await window.ea.submitQuickAddTask(payload);
    if (result.ok) {
      return result.taskId;
    }
    throw new Error(result.error);
  }

  async createNewTags(_tagTitles: string[]): Promise<string[]> {
    return [];
  }

  isMarkdownTaskList(_text: string): boolean {
    return false;
  }

  async handleMarkdownPaste(_pastedText: string): Promise<void> {
    return undefined;
  }

  getIssueIcon(_issueType: AddTaskSuggestion['issueType']): string | undefined {
    return undefined;
  }

  getFilteredIssueSuggestions$(
    _input$: Observable<string>,
    _isSearchIssueProviders$: Observable<boolean>,
    _isSearchLoading: WritableSignal<boolean>,
  ): Observable<AddTaskSuggestion[]> {
    return of([]);
  }

  async handleSuggestionSelected(
    _suggestion: AddTaskSuggestion,
    _planForDay: string | undefined,
    _isAddToBacklog: boolean,
    _isAddToBottom: boolean,
  ): Promise<AddTaskBarSuggestionResult | null> {
    return null;
  }

  onHudOpened(listener: () => void): () => void {
    return window.ea.onQuickAddOpened(listener);
  }

  async refreshSnapshot(): Promise<void> {
    const result = await window.ea.requestQuickAddSnapshot().catch(() => null);
    if (!result) {
      return;
    }
    if (!result.ok) {
      return;
    }
    const snapshot = result.snapshot;
    this._snapshot.set(snapshot);
    void this._translateService.use(snapshot.lng);
    this._activeWorkContext$.next(_toWorkContext(snapshot.activeWorkContext));
    this._tasksConfig$.next({
      ...EMPTY_TASKS_CONFIG,
      defaultProjectId: snapshot.defaultProjectId,
    });
    this._shortSyntax$.next(snapshot.shortSyntax);
    this._mentionConfig$.next(_buildMentionConfig(snapshot));
    this._applyTheme(snapshot);
  }

  private _applyTheme(snapshot: QuickAddHudSnapshot): void {
    _replaceClasses(document.documentElement, this._htmlClasses, [
      'isQuickAddHud',
      ...snapshot.theme.htmlClasses,
    ]);
    _replaceClasses(document.body, this._bodyClasses, [
      'isQuickAddHud',
      ...snapshot.theme.bodyClasses,
    ]);
    _replaceCssVars(
      document.documentElement,
      this._htmlCssVars,
      snapshot.theme.htmlCssVars,
    );
    _replaceCssVars(document.body, this._bodyCssVars, snapshot.theme.bodyCssVars);
  }
}

const _replaceCssVars = (
  el: HTMLElement,
  previousValues: Map<string, string>,
  nextValues: Record<string, string>,
): void => {
  const nextKeys = new Set(Object.keys(nextValues));

  previousValues.forEach((_, key) => {
    if (!nextKeys.has(key)) {
      el.style.removeProperty(key);
      previousValues.delete(key);
    }
  });

  Object.entries(nextValues).forEach(([key, value]) => {
    el.style.setProperty(key, value);
    previousValues.set(key, value);
  });
};

const _signalToObservable = <T>(source: () => T): Observable<T> =>
  new Observable<T>((subscriber) => {
    subscriber.next(source());
    const id = window.setInterval(() => subscriber.next(source()), 250);
    return () => window.clearInterval(id);
  });

interface MentionListItem extends MentionItem {
  title: string;
  id?: string;
  icon?: string;
  color?: string;
  isEmoji?: boolean;
}

const _toProject = (project: QuickAddHudProject): Project =>
  ({
    ...DEFAULT_PROJECT,
    id: project.id,
    title: project.title,
    icon: project.icon ?? null,
    theme: {
      ...DEFAULT_PROJECT.theme,
      ...project.theme,
    },
    isEnableBacklog: project.isEnableBacklog,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
  }) satisfies Project;

const _toTag = (tag: QuickAddHudTag): Tag =>
  ({
    ...DEFAULT_TAG,
    id: tag.id,
    title: tag.title,
    icon: tag.icon ?? null,
    color: tag.color ?? null,
    theme: {
      ...DEFAULT_TAG.theme,
      ...tag.theme,
    },
    taskIds: [],
  }) satisfies Tag;

const _toWorkContext = (
  workContext: QuickAddHudWorkContext | null,
): WorkContext | null =>
  workContext
    ? ({
        ...WORK_CONTEXT_DEFAULT_COMMON,
        id: workContext.id,
        title: workContext.title,
        type: workContext.type,
        theme: {
          ...WORK_CONTEXT_DEFAULT_COMMON.theme,
          ...workContext.theme,
        },
        routerLink: '',
        taskIds: [],
        noteIds: [],
      } satisfies WorkContext)
    : null;

const _buildMentionConfig = (snapshot: QuickAddHudSnapshot): MentionConfig => {
  const mentions: Mentions[] = [];
  const cfg = snapshot.shortSyntax;
  const defaultColor =
    snapshot.activeWorkContext?.theme?.primary || DEFAULT_PROJECT_COLOR;

  if (cfg.isEnableTag) {
    mentions.push({
      items: snapshot.tags.map(
        (tag): MentionListItem => ({
          title: tag.title,
          id: tag.id,
          icon: tag.icon || 'label',
          color: tag.color || tag.theme?.primary || DEFAULT_TAG_COLOR,
          isEmoji: !!tag.icon && isSingleEmoji(tag.icon),
        }),
      ),
      labelKey: 'title',
      triggerChar: '#',
    });
  }

  if (cfg.isEnableDue) {
    const chronoItems = CHRONO_SUGGESTIONS.map(
      (title): MentionListItem => ({
        title,
        icon: 'schedule',
      }),
    );
    mentions.push({
      items: chronoItems,
      labelKey: 'title',
      triggerChar: '@',
    });
    mentions.push({
      items: chronoItems,
      labelKey: 'title',
      triggerChar: '!',
    });
  }

  if (cfg.isEnableProject) {
    mentions.push({
      items: snapshot.projects.map(
        (project): MentionListItem => ({
          title: project.title,
          id: project.id,
          icon: project.icon || DEFAULT_PROJECT_ICON,
          color: project.theme?.primary || defaultColor,
          isEmoji: !!project.icon && isSingleEmoji(project.icon),
        }),
      ),
      labelKey: 'title',
      triggerChar: '+',
    });
  }

  return {
    mentions,
    triggerChar: undefined,
  };
};

const _replaceClasses = (
  el: HTMLElement,
  oldClasses: Set<string>,
  newClasses: string[],
): void => {
  oldClasses.forEach((className) => el.classList.remove(className));
  oldClasses.clear();
  newClasses.filter(Boolean).forEach((className) => {
    el.classList.add(className);
    oldClasses.add(className);
  });
};
