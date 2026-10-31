import { getTaskPriority } from '../tasks/task-priority.const';
import { computed, effect, Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, animationFrameScheduler, combineLatest, of } from 'rxjs';
import { map, observeOn, switchMap, take } from 'rxjs/operators';
import { TaskWithSubTasks } from '../tasks/task.model';
import { selectAllProjects } from '../project/store/project.selectors';
import { Store } from '@ngrx/store';
import { Project } from '../project/project.model';
import { Tag } from '../tag/tag.model';
import { TODAY_TAG } from '../tag/tag.const';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { getDbDateStr } from '../../util/get-db-date-str';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../root-store/app-state/app-state.selectors';
import {
  buildTaskComparator,
  createTaskCriteriaCtx,
  matchesTaskCriteria,
} from '../tasks/task-criteria/task-criteria';
import { filterToCriteria, SORT_OPTION_TO_KEY } from './filter-to-criteria';
import { TaskCriteria } from '../tasks/task-criteria/task-criteria.model';
import { buildViewFromList, ViewSourceList } from './save-as-view';
import { BoardCfg } from '../boards/boards.model';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { MenuTreeService } from '../menu-tree/menu-tree.service';
import {
  SortOption,
  CustomizerContextState,
  DEFAULT_OPTIONS,
  FilterOption,
  GroupOption,
  SORT_OPTION_TYPE,
  GROUP_OPTION_TYPE,
  FILTER_OPTION_TYPE,
  SORT_ORDER,
  OPTIONS,
  NO_TAG_GROUP_ID,
} from './types';
import { DateAdapter } from '@angular/material/core';
import { lsGetJSON, lsSetJSON } from '../../util/ls-util';
import { LS } from '../../core/persistence/storage-keys.const';
import { LanguageService } from 'src/app/core/language/language.service';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';

const GROUP_OPTIONS_NO_PROJECT = OPTIONS.group.list.filter(
  (opt) => opt.type !== GROUP_OPTION_TYPE.project,
);

// Display keys for the two virtual tag-group buckets (kept as constants so the
// grouping and the drag-to-retag id-map agree on the exact strings).
const NO_TAG_GROUP_KEY = 'No tag';
const UNKNOWN_TAG_GROUP_KEY = 'Unknown tag';

/** One group header of a grouped work view, in display order. */
export interface CustomizedTaskGroup {
  key: string;
  tasks: TaskWithSubTasks[];
  /**
   * Drag-to-retag target for tag groups, see `groupTagIdByKey`. `null` for every
   * other grouping: `task-list` treats only `undefined` as "not a group list",
   * so `TaskMultiDragService.canDrop` must keep rejecting group drops here.
   */
  tagId: string | null;
}

/** Result of {@link TaskViewCustomizerService.customizeUndoneTasks}. */
export interface CustomizedUndoneTasks {
  list: TaskWithSubTasks[];
  grouped?: Record<string, TaskWithSubTasks[]>;
  /**
   * `grouped` in display order, computed once per emission so the template
   * doesn't re-sort the group keys on every change-detection pass.
   */
  groups?: CustomizedTaskGroup[];
  /**
   * Tag grouping only: group-header title → its tagId, or `null` for buckets
   * with no single tag ('No tag', 'Unknown tag', or a title shared by several
   * tags). Drives drag-to-retag in the work view (dragging a task into another
   * tag group reassigns its tags). Absent for non-tag groupings.
   */
  groupTagIdByKey?: Record<string, string | null>;
}

@Injectable({ providedIn: 'root' })
export class TaskViewCustomizerService {
  private store = inject(Store);
  private _workContextService = inject(WorkContextService);
  private _dateAdapter = inject(DateAdapter);
  private readonly _todayStr = this.store.selectSignal(selectTodayStr);
  private readonly _startOfNextDayDiffMs = this.store.selectSignal(
    selectStartOfNextDayDiffMs,
  );
  private readonly _criteriaCtx = computed(() =>
    createTaskCriteriaCtx({
      todayStr: this._todayStr() || getDbDateStr(new Date()),
      startOfNextDayDiffMs: this._startOfNextDayDiffMs() ?? 0,
      // Reads the localization config signal, so a changed week start applies.
      firstDayOfWeek: this._dateAdapter.getFirstDayOfWeek(),
      // Task lists read a plain day before a time; boards the other way round.
      isDayBeforeTime: true,
    }),
  );
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _menuTreeService = inject(MenuTreeService);
  private _languageService = inject(LanguageService);
  private _translateService = inject(TranslateService);
  private _collator: Intl.Collator | null = null;
  private _collatorLocale: string | null = null;

  public selectedSort = signal<SortOption>(DEFAULT_OPTIONS.sort);
  public selectedGroup = signal<GroupOption>(DEFAULT_OPTIONS.group);
  public selectedFilter = signal<FilterOption>(DEFAULT_OPTIONS.filter);
  public collapsedGroupIds = signal<string[]>([]);

  // The customizer is a menu anchored to the header's filter button, so the
  // keyboard shortcut can only ask that button to open it.
  private readonly _openMenuRequest$ = new Subject<void>();
  readonly openMenuRequest$ = this._openMenuRequest$.asObservable();

  requestOpenMenu(): void {
    this._openMenuRequest$.next();
  }

  isCustomized = computed(() => {
    return [
      this.selectedSort().type,
      this.selectedGroup().type,
      this.selectedFilter().type,
    ].some((x) => x !== null);
  });

  private _isInProject = toSignal(this._workContextService.isActiveWorkContextProject$, {
    initialValue: false,
  });

  // "Group By: Project" would collapse into a single group inside a single-project
  // view, so offer it only for tag contexts. See issue #7279.
  availableGroupOptions = computed(() =>
    this._isInProject() ? GROUP_OPTIONS_NO_PROJECT : OPTIONS.group.list,
  );

  private _stateByContext: Record<string, CustomizerContextState> = lsGetJSON<
    Record<string, CustomizerContextState>
  >(LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT, {});
  private _currentContextKey: string | null = null;

  constructor() {
    this._initProjects();

    // Load stored customizations for the active work context, and reset to
    // defaults when switching contexts so filters don't leak across them.
    this._workContextService.activeWorkContextTypeAndId$
      .pipe(takeUntilDestroyed())
      .subscribe(({ activeId, activeType }) => {
        this._currentContextKey = `${activeType}:${activeId}`;
        const stored = this._stateByContext[this._currentContextKey];
        this.selectedSort.set(stored?.sort ?? DEFAULT_OPTIONS.sort);
        this.selectedGroup.set(this._sanitizeGroupForContext(stored?.group, activeType));
        this.selectedFilter.set(this._sanitizeFilter(stored?.filter));
        this.collapsedGroupIds.set(stored?.collapsedGroupIds ?? []);
      });

    effect(() => {
      const sort = this.selectedSort();
      const group = this.selectedGroup();
      const filter = this.selectedFilter();
      const collapsedGroupIds = this.collapsedGroupIds();
      if (!this._currentContextKey) return;
      this._stateByContext = {
        ...this._stateByContext,
        [this._currentContextKey]: { sort, group, filter, collapsedGroupIds },
      };
      lsSetJSON(LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT, this._stateByContext);
    });
  }

  toggleGroupExpansion(groupId: string): void {
    const current = this.collapsedGroupIds();
    if (current.includes(groupId)) {
      this.collapsedGroupIds.set(current.filter((id) => id !== groupId));
    } else {
      this.collapsedGroupIds.set([...current, groupId]);
    }
  }

  private _allProjects: Project[] = [];
  private _projectsLoaded = false;

  /**
   * Changes only when the tags' sidebar order or titles change — not on every
   * tag update (e.g. its `taskIds` when tasks are reordered), so it can drive
   * re-customization without re-running it for unrelated tag writes.
   */
  private _tagOrderKey = computed(() =>
    this._tagService
      .tagsInTreeOrder()
      .map((tag) => `${tag.id}\u0000${tag.title}`)
      .join('\u0001'),
  );

  /** Read straight from the signal so it's always current inside the stream. */
  private _allTags(): Tag[] {
    return this._tagService.tagsInTreeOrder();
  }

  private _initProjects(): void {
    if (!this._projectsLoaded) {
      this.store
        .select(selectAllProjects)
        .pipe(takeUntilDestroyed())
        .subscribe((projects) => {
          this._allProjects = projects;
        });
      this._projectsLoaded = true;
    }
  }

  private _sanitizeGroupForContext(
    stored: GroupOption | undefined,
    activeType: WorkContextType,
  ): GroupOption {
    if (!stored) return DEFAULT_OPTIONS.group;
    if (
      activeType === WorkContextType.PROJECT &&
      stored.type === GROUP_OPTION_TYPE.project
    ) {
      return DEFAULT_OPTIONS.group;
    }
    return stored;
  }

  // Unlike _sanitizeGroupForContext (which passes the stored value through),
  // re-resolve the option from the current OPTIONS.filter.list and keep only the
  // user's `preset`. The persisted `label` can be stale after a translation-key
  // change (the panel renders selectedFilter().label directly), so we always
  // adopt the current label; an unknown stored `type` falls back to the default.
  private _sanitizeFilter(stored: FilterOption | undefined): FilterOption {
    if (!stored) return DEFAULT_OPTIONS.filter;

    const currentFilter = OPTIONS.filter.list.find(
      (option) => option.type === stored.type,
    );
    let preset = stored.preset ?? null;
    // Historical local presets used the same string encoding as task priorities.
    // Adopt the current menu value without rewriting the tasks themselves.
    if (
      stored.type === FILTER_OPTION_TYPE.priority &&
      (preset === 'high' || preset === 'medium' || preset === 'low')
    ) {
      preset = String(getTaskPriority(preset));
    }
    if (!currentFilter) return DEFAULT_OPTIONS.filter;

    const sanitized: FilterOption = {
      ...currentFilter,
      preset,
    };
    if (stored.type === FILTER_OPTION_TYPE.tag) {
      if (stored.tagIds) sanitized.tagIds = stored.tagIds;
      if (stored.tagFilterMode) sanitized.tagFilterMode = stored.tagFilterMode;
    }
    return sanitized;
  }

  customizeUndoneTasks(
    undoneTasks$: Observable<TaskWithSubTasks[]>,
  ): Observable<CustomizedUndoneTasks> {
    return combineLatest([
      undoneTasks$,
      toObservable(this.selectedSort),
      toObservable(this.selectedGroup),
      toObservable(this.selectedFilter),
      // Tag filtering, tag grouping and group order all read the tags; re-run
      // when their sidebar order or titles change, not only when tasks do.
      toObservable(this._tagOrderKey),
      // Date filters use the logical day: re-run at day rollover and when the
      // start of day or the first day of the week changes.
      toObservable(this._criteriaCtx),
    ]).pipe(
      map(([tasks, sort, group, filter, , ctx]) => {
        const criteria = this._toCriteria(filter);
        const isDefaultFilter = !criteria;
        const isDefaultSort = !sort.type;
        const isDefaultGroup = !group.type;

        if (isDefaultFilter && isDefaultSort && isDefaultGroup) {
          return { result: { list: tasks }, isDefault: true };
        }

        const filtered = criteria
          ? tasks.filter((task) => matchesTaskCriteria(task, criteria, ctx))
          : tasks;
        const sorted = isDefaultSort
          ? filtered
          : this.applySort(filtered, sort.type, sort.order);
        const grouped = !isDefaultGroup
          ? this.applyGrouping(sorted, group.type)
          : undefined;
        const groupTagIdByKey =
          grouped && group.type === GROUP_OPTION_TYPE.tag
            ? this._buildGroupTagIdByKey(grouped)
            : undefined;
        const groups = grouped
          ? this._orderGroupKeys(grouped, group.type).map((key) => ({
              key,
              tasks: grouped[key],
              tagId: groupTagIdByKey?.[key] ?? null,
            }))
          : undefined;

        return {
          result: { list: sorted, grouped, groups, groupTagIdByKey },
          isDefault: false,
        };
      }),
      // Emit the default (uncustomized) list synchronously, but keep the
      // customized path on the animation-frame scheduler. The customized branch
      // does heavier sort/group/filter work and is driven by the customizer
      // signals (`toObservable(selectedSort/Group/Filter)`); deferring it
      // batches the rapid emissions that fire when switching work context (the
      // original reason this frame-defer was added, commit fddedf3fa6). The
      // default branch is store-driven only — emitting it on the same tick drops
      // the extra frame between a drag-drop dispatch and the list re-render that
      // otherwise surfaces as a snap-back flicker on drop.
      switchMap(({ result, isDefault }) =>
        isDefault ? of(result) : of(result).pipe(observeOn(animationFrameScheduler)),
      ),
    );
  }

  /**
   * The filter as task criteria (`null`: no filter). A deleted tag stays in
   * stored tagIds, but the chip list hides it; only existing ids count.
   */
  private _toCriteria(filter: FilterOption): TaskCriteria | null {
    return filterToCriteria(filter, {
      tags: this._allTags().filter((tag) => tag.id !== TODAY_TAG.id),
      projects: this._allProjects,
    });
  }

  /** A one-column view showing what `list` shows with the current filter and sort. */
  buildViewFromList(list: ViewSourceList): BoardCfg {
    return buildViewFromList({
      list,
      filter: this.selectedFilter(),
      sort: this.selectedSort(),
      tags: this._allTags().filter((tag) => tag.id !== TODAY_TAG.id),
      projects: this._allProjects,
    });
  }

  private _filterTasks(
    tasks: TaskWithSubTasks[],
    filter: FilterOption,
  ): TaskWithSubTasks[] {
    const criteria = this._toCriteria(filter);
    const ctx = this._criteriaCtx();
    return criteria
      ? tasks.filter((task) => matchesTaskCriteria(task, criteria, ctx))
      : tasks;
  }

  private applySort(
    tasks: TaskWithSubTasks[],
    sortType: SORT_OPTION_TYPE | null,
    order?: SORT_ORDER,
  ): TaskWithSubTasks[] {
    if (!sortType) {
      return [...tasks];
    }
    const locale = this._languageService.detect();
    if (!this._collator || this._collatorLocale !== locale) {
      this._collator = new Intl.Collator(locale, {
        sensitivity: 'base',
        numeric: true,
      });
      this._collatorLocale = locale;
    }
    const key = SORT_OPTION_TO_KEY[sortType];
    const compare = buildTaskComparator(key, {
      collator: this._collator,
      tagRankById:
        key === 'tag'
          ? new Map(this._tagsInSidebarOrder().map((tag, index) => [tag.id, index]))
          : undefined,
    });
    // Same comparators as board columns, so a saved view sorts like its list.
    const factor = order === SORT_ORDER.DESC ? -1 : 1;
    return [...tasks].sort((a, b) => compare(a, b) * factor);
  }

  private applyGrouping(
    tasks: TaskWithSubTasks[],
    groupType: GROUP_OPTION_TYPE | null,
  ): Record<string, TaskWithSubTasks[]> {
    if (groupType === GROUP_OPTION_TYPE.tag) {
      return this._groupByTag(tasks);
    }

    return tasks.reduce(
      (acc, task) => {
        if (groupType === GROUP_OPTION_TYPE.project) {
          const project = this._allProjects.find((p) => p.id === task.projectId);
          const key = project ? project.title : 'No project';
          acc[key] = acc[key] || [];
          acc[key].push(task);
        } else if (groupType === GROUP_OPTION_TYPE.scheduledDate) {
          const key =
            task.dueDay ||
            (task.dueWithTime ? getDbDateStr(task.dueWithTime) : 'No date');
          acc[key] = acc[key] || [];
          acc[key].push(task);
        } else if (groupType === GROUP_OPTION_TYPE.deadline) {
          const key =
            task.deadlineDay ||
            (task.deadlineWithTime
              ? getDbDateStr(task.deadlineWithTime)
              : this._translateService.instant(
                  T.F.TASK_VIEW.CUSTOMIZER.GROUP_DEADLINE_NONE,
                ));
          acc[key] = acc[key] || [];
          acc[key].push(task);
        }
        return acc;
      },
      {} as Record<string, TaskWithSubTasks[]>,
    );
  }

  /**
   * Order group headers for display. Tag groups follow the sidebar (menu-tree)
   * order so they match the tag-toggle menu (#8400); other group types keep the
   * natural ascending order the keyvalue pipe used previously. Special tag
   * buckets ('No tag', 'Unknown tag') sort after the real tags.
   */
  private _orderGroupKeys(
    grouped: Record<string, TaskWithSubTasks[]>,
    groupType: GroupOption['type'],
  ): string[] {
    const keys = Object.keys(grouped);
    const ascending = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

    if (groupType !== GROUP_OPTION_TYPE.tag) {
      return keys.sort(ascending);
    }

    const titleOrder = this._getTagTitleOrderMap();
    return keys.sort((a, b) => {
      const ai = titleOrder.get(a);
      const bi = titleOrder.get(b);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return ascending(a, b);
    });
  }

  /**
   * Tags in sidebar (menu-tree) order. The virtual TODAY tag is excluded so this
   * matches the tag-toggle menus, which are fed the my-day-excluded list, and so
   * its trailing index can never leak into ordering (it's never a real task tag).
   */
  private _tagsInSidebarOrder(): Tag[] {
    return this._menuTreeService.buildTagListInTreeOrder(
      this._allTags().filter((t) => t.id !== TODAY_TAG.id),
    );
  }

  /**
   * Per-title metadata in sidebar (menu-tree) order — the single source for both
   * group ordering and the drag-to-retag id-map, so the two can't drift:
   * - `index`: lowest sidebar index among tags with that title (for ordering).
   * - `id`: the tagId, or `null` when several tags share the title (ambiguous,
   *   so retag can't pick one).
   * Duplicate-titled tags collapse to one slot, matching {@link _groupByTag}
   * which also keys its buckets by title. TODAY is excluded by
   * {@link _tagsInSidebarOrder} (virtual membership, never a real tagId), so it
   * can never appear — see ARCHITECTURE-DECISIONS #2 / sync rule #5.
   */
  private _tagMetaByTitle(): Map<string, { id: string | null; index: number }> {
    const byTitle = new Map<string, { id: string | null; index: number }>();
    this._tagsInSidebarOrder().forEach((tag, index) => {
      const existing = byTitle.get(tag.title);
      if (existing) {
        existing.id = null; // duplicate title → ambiguous
      } else {
        byTitle.set(tag.title, { id: tag.id, index });
      }
    });
    return byTitle;
  }

  private _getTagTitleOrderMap(): Map<string, number> {
    const order = new Map<string, number>();
    this._tagMetaByTitle().forEach((meta, title) => order.set(title, meta.index));
    return order;
  }

  /**
   * Map each tag-group header title to its drag-to-retag target:
   * - a real tagId for a single-tag group,
   * - {@link NO_TAG_GROUP_ID} for the 'No tag' bucket (a drop there clears tags),
   * - `null` for the 'Unknown tag' bucket or a title shared by several tags
   *   (ambiguous — can't be retagged).
   */
  private _buildGroupTagIdByKey(
    grouped: Record<string, TaskWithSubTasks[]>,
  ): Record<string, string | null> {
    const meta = this._tagMetaByTitle();
    const out: Record<string, string | null> = {};
    Object.keys(grouped).forEach((key) => {
      const realTag = meta.get(key);
      // A real tag owning this title wins (its id, or null when several tags
      // share it). This guards the case of a user tag literally titled "No tag":
      // dropping there adds that tag instead of hitting the clear-tags sentinel,
      // which is reserved for the genuine virtual untagged bucket.
      if (realTag) {
        out[key] = realTag.id;
      } else if (key === NO_TAG_GROUP_KEY) {
        out[key] = NO_TAG_GROUP_ID;
      } else {
        out[key] = null;
      }
    });
    return out;
  }

  private _groupByTag(tasks: TaskWithSubTasks[]): Record<string, TaskWithSubTasks[]> {
    const tagById = new Map(this._allTags().map((tag) => [tag.id, tag]));
    const groupedByTagId = new Map<string, TaskWithSubTasks[]>();
    const unknownTagTasks: TaskWithSubTasks[] = [];
    const noTagTasks: TaskWithSubTasks[] = [];
    // Inside a tag's own view every task carries that tag, so its group would
    // just repeat the whole list (#9630). TODAY is virtual and never in tagIds,
    // so this is a no-op there.
    const contextTagId =
      this._workContextService.activeWorkContextType === WorkContextType.TAG
        ? this._workContextService.activeWorkContextId
        : undefined;

    tasks.forEach((task) => {
      const tagIds = (task.tagIds ?? []).filter((tagId) => tagId !== contextTagId);
      if (!tagIds.length) {
        noTagTasks.push(task);
        return;
      }

      tagIds.forEach((tagId) => {
        if (tagById.has(tagId)) {
          const tagTasks = groupedByTagId.get(tagId) ?? [];
          tagTasks.push(task);
          groupedByTagId.set(tagId, tagTasks);
        } else {
          unknownTagTasks.push(task);
        }
      });
    });

    const grouped: Record<string, TaskWithSubTasks[]> = {};
    this._allTags().forEach((tag) => {
      const tagTasks = groupedByTagId.get(tag.id);
      if (tagTasks?.length) {
        // Distinct tags can share a title; merge their tasks into the same
        // title-keyed bucket instead of overwriting, matching the previous
        // grouping behavior and _getTagTitleOrderMap's single-slot contract.
        grouped[tag.title] = (grouped[tag.title] ?? []).concat(tagTasks);
      }
    });
    if (unknownTagTasks.length) {
      grouped[UNKNOWN_TAG_GROUP_KEY] = unknownTagTasks;
    }
    if (noTagTasks.length) {
      grouped[NO_TAG_GROUP_KEY] = noTagTasks;
    }

    return grouped;
  }

  setSort(val: SortOption): void {
    const current = this.selectedSort();
    const isSame = val.type === current.type;
    const next = {
      ...val,
      ...(isSame && {
        order: current.order === SORT_ORDER.ASC ? SORT_ORDER.DESC : SORT_ORDER.ASC,
      }),
    };
    this.selectedSort.set(next);
  }

  setGroup(val: GroupOption): void {
    this.selectedGroup.set(val);
  }

  setFilter(val: FilterOption): void {
    this.selectedFilter.set(val);
  }

  resetAll(): void {
    this.setSort(DEFAULT_OPTIONS.sort);
    this.setGroup(DEFAULT_OPTIONS.group);
    this.setFilter(DEFAULT_OPTIONS.filter);
  }

  /**
   * Instantly save sort changes by reordering tasks in the current work context
   * ! Saved sorting will be default
   */
  async saveSort(): Promise<void> {
    const selectedSort = { ...this.selectedSort() };

    // Saved sorting will be default
    this.setSort(DEFAULT_OPTIONS.sort);

    const workContextId = this._workContextService.activeWorkContextId;
    const workContextType = this._workContextService.activeWorkContextType;
    if (!workContextId || !workContextType) return;

    // Tasks in the current work context
    const [allTasks, undoneTasks] = await Promise.all([
      this._workContextService.mainListTasks$.pipe(take(1)).toPromise(),
      this._workContextService.undoneTasks$.pipe(take(1)).toPromise(),
    ]);

    if (!allTasks?.length || !undoneTasks?.length) return;

    const sortedTasks = this.applySort(
      undoneTasks,
      selectedSort.type,
      selectedSort.order,
    );
    if (!sortedTasks.length) return;

    const sortedIdQueue = sortedTasks.map((task) => task.id);
    const sortedIdSet = new Set(sortedIdQueue);
    const newOrderedIds = allTasks.map((task) => {
      if (!sortedIdSet.has(task.id)) return task.id;

      const nextId = sortedIdQueue.shift();
      return nextId ?? task.id;
    });

    const isOrderChanged = allTasks.some((task, idx) => task.id !== newOrderedIds[idx]);
    if (!isOrderChanged) return;

    if (workContextType === WorkContextType.PROJECT) {
      this._projectService.update(workContextId, { taskIds: newOrderedIds });
    } else if (workContextType === WorkContextType.TAG) {
      this._tagService.updateTag(workContextId, { taskIds: newOrderedIds });
    }
  }
}
