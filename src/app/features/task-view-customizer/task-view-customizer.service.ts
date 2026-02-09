import { Injectable, signal, inject, effect } from '@angular/core';
import { Observable, animationFrameScheduler, combineLatest } from 'rxjs';
import { map, observeOn, take } from 'rxjs/operators';
import { TaskWithSubTasks } from '../tasks/task.model';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectAllTags } from './../tag/store/tag.reducer';
import { Store } from '@ngrx/store';
import { Project } from '../project/project.model';
import { Tag } from '../tag/tag.model';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { computed } from '@angular/core';
import { getDbDateStr } from '../../util/get-db-date-str';
import { getWeekRange } from '../../util/get-week-range';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import {
  SortOption,
  DEFAULT_OPTIONS,
  FilterOption,
  GroupOption,
  SORT_OPTION_TYPE,
  GROUP_OPTION_TYPE,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  SORT_ORDER,
  FILTER_COMMON,
} from './types';
import { DateAdapter } from '@angular/material/core';
import { lsGetJSON, lsSetJSON } from '../../util/ls-util';
import { LS } from '../../core/persistence/storage-keys.const';
import { LanguageService } from 'src/app/core/language/language.service';

@Injectable({ providedIn: 'root' })
export class TaskViewCustomizerService {
  private store = inject(Store);
  private _workContextService = inject(WorkContextService);
  private _dateAdapter = inject(DateAdapter);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _languageService = inject(LanguageService);

  public selectedSort = signal<SortOption>(
    lsGetJSON<SortOption>(LS.TASK_VIEW_CUSTOMIZER_SORT, DEFAULT_OPTIONS.sort) ??
      DEFAULT_OPTIONS.sort,
  );
  public selectedGroup = signal<GroupOption>(
    lsGetJSON<GroupOption>(LS.TASK_VIEW_CUSTOMIZER_GROUP, DEFAULT_OPTIONS.group) ??
      DEFAULT_OPTIONS.group,
  );
  public selectedFilter = signal<FilterOption>(
    lsGetJSON<FilterOption>(LS.TASK_VIEW_CUSTOMIZER_FILTER, DEFAULT_OPTIONS.filter) ??
      DEFAULT_OPTIONS.filter,
  );

  isCustomized = computed(() => {
    return [
      this.selectedSort().type,
      this.selectedGroup().type,
      this.selectedFilter().type,
    ].some((x) => x !== null);
  });

  constructor() {
    this._initProjects();
    this._initTags();

    effect(() => {
      lsSetJSON(LS.TASK_VIEW_CUSTOMIZER_SORT, this.selectedSort());
    });

    effect(() => {
      lsSetJSON(LS.TASK_VIEW_CUSTOMIZER_GROUP, this.selectedGroup());
    });

    effect(() => {
      lsSetJSON(LS.TASK_VIEW_CUSTOMIZER_FILTER, this.selectedFilter());
    });
  }

  private _allProjects: Project[] = [];
  private _projectsLoaded = false;
  private _allTags: Tag[] = [];
  private _tagsLoaded = false;

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

  private _initTags(): void {
    if (!this._tagsLoaded) {
      this.store
        .select(selectAllTags)
        .pipe(takeUntilDestroyed())
        .subscribe((tags) => {
          this._allTags = tags;
        });
      this._tagsLoaded = true;
    }
  }

  customizeUndoneTasks(
    undoneTasks$: Observable<TaskWithSubTasks[]>,
  ): Observable<{ list: TaskWithSubTasks[]; grouped?: any }> {
    return combineLatest([
      undoneTasks$,
      toObservable(this.selectedSort),
      toObservable(this.selectedGroup),
      toObservable(this.selectedFilter),
    ]).pipe(
      observeOn(animationFrameScheduler),
      map(([undone, sort, group, filter]) => {
        const normalizedFilterVal =
          typeof filter.preset === 'string' ? filter.preset.trim() : filter.preset;
        const filterValueToUse =
          typeof normalizedFilterVal === 'string' ? normalizedFilterVal : '';

        const isDefaultFilter = !filter.type || !filterValueToUse;
        const isDefaultSort = !sort.type;
        const isDefaultGroup = !group.type;

        if (isDefaultFilter && isDefaultSort && isDefaultGroup) {
          return { list: undone };
        }

        const filtered = isDefaultFilter
          ? undone
          : this.applyFilter(undone, filter.type, filterValueToUse);
        const sorted = isDefaultSort
          ? filtered
          : this.applySort(filtered, sort.type, sort.order);
        const grouped = !isDefaultGroup
          ? this.applyGrouping(sorted, group.type)
          : undefined;

        return { list: sorted, grouped };
      }),
    );
  }

  private applyFilter(
    tasks: TaskWithSubTasks[],
    type: FILTER_OPTION_TYPE | FILTER_COMMON | null,
    value: string,
  ): TaskWithSubTasks[] {
    if (!type || !value) return tasks;

    switch (type) {
      case FILTER_OPTION_TYPE.tag:
        if (value === FILTER_COMMON.NOT_SPECIFIED) {
          return tasks.filter((t) => !t.tagIds.length);
        }

        const tag = this._allTags.find((t) =>
          t.title.toLowerCase().includes(value.toLowerCase().trim()),
        );
        if (!tag) return [];
        return tasks.filter((task) => task.tagIds?.includes(tag.id));
      case FILTER_OPTION_TYPE.project:
        const project = this._allProjects.find((p) =>
          p.title.toLowerCase().includes(value.toLowerCase().trim()),
        );
        if (!project) return [];
        return tasks.filter((task) => task.projectId === project.id);
      case FILTER_OPTION_TYPE.scheduledDate:
        if (value === FILTER_COMMON.NOT_SPECIFIED) {
          return tasks.filter((task) => !task.dueDay && !task.dueWithTime);
        }

        const _today = new Date(); // ! Don't modify this date
        const _firstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();

        const todayStr = getDbDateStr(_today);
        const tomorrowStr = getDbDateStr(
          new Date(new Date().setDate(_today.getDate() + 1)),
        );

        return tasks.filter((task) => {
          const dueStr = task.dueDay
            ? task.dueDay
            : task.dueWithTime
              ? getDbDateStr(task.dueWithTime)
              : null;

          if (!dueStr) return false;

          switch (value) {
            case FILTER_SCHEDULE.today:
              return dueStr.startsWith(todayStr);

            case FILTER_SCHEDULE.tomorrow:
              return dueStr.startsWith(tomorrowStr);

            // From today to end of week
            case FILTER_SCHEDULE.thisWeek: {
              const weekRange = getWeekRange(_today, _firstDayOfWeek);
              // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
              // which is lexicographically sortable. This avoids timezone conversion issues.
              return (
                dueStr >= getDbDateStr(weekRange.start) &&
                dueStr <= getDbDateStr(weekRange.end)
              );
            }

            case FILTER_SCHEDULE.nextWeek: {
              const nextWeekStartDate = new Date(
                new Date().setDate(_today.getDate() + 7),
              );
              const weekRange = getWeekRange(nextWeekStartDate, _firstDayOfWeek);
              // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
              // which is lexicographically sortable. This avoids timezone conversion issues.
              return (
                dueStr >= getDbDateStr(weekRange.start) &&
                dueStr <= getDbDateStr(weekRange.end)
              );
            }

            case FILTER_SCHEDULE.thisMonth: {
              const yearMonth = getDbDateStr(_today).substring(0, 7); // YYYY-MM
              return dueStr.startsWith(yearMonth);
            }

            case FILTER_SCHEDULE.nextMonth: {
              const nextMonth = new Date(new Date().setMonth(_today.getMonth() + 1));
              const yearMonth = getDbDateStr(nextMonth).substring(0, 7); // YYYY-MM
              return dueStr.startsWith(yearMonth);
            }

            default:
              return true;
          }
        });
      case FILTER_OPTION_TYPE.estimatedTime:
        if (value === FILTER_COMMON.NOT_SPECIFIED) {
          return tasks.filter((task) => task.timeEstimate === 0);
        }

        return tasks.filter((task) => task.timeEstimate >= +value);
      case FILTER_OPTION_TYPE.timeSpent:
        if (value === FILTER_COMMON.NOT_SPECIFIED) {
          return tasks.filter((task) => task.timeSpent === 0);
        }

        return tasks.filter((task) => {
          const spent = task.timeSpentOnDay
            ? Object.values(task.timeSpentOnDay).reduce((a, b) => a + b, 0)
            : 0;
          return spent >= +value;
        });
      default:
        return tasks;
    }
  }

  private applySort(
    tasks: TaskWithSubTasks[],
    sortType: SORT_OPTION_TYPE | null,
    order?: SORT_ORDER,
  ): TaskWithSubTasks[] {
    const tasksCopy = [...tasks];

    // Factor for bidirectional for sorting
    const factor = order === SORT_ORDER.DESC ? -1 : 1;

    const sortByTitle = (a: string, b: string, multiplier = 1): number => {
      const collator = new Intl.Collator(this._languageService.detect(), {
        sensitivity: 'base',
        numeric: true,
      });

      return collator.compare(a, b) * multiplier;
    };

    const sortByTagTitle = (a: TaskWithSubTasks, b: TaskWithSubTasks): number => {
      // Helper function to get the first tag title from a task
      const getFirstTagTitle = (t: TaskWithSubTasks): string | null => {
        const titles = t.tagIds
          .map((id) => this._allTags.find((tag) => tag.id === id)?.title)
          .filter((v) => typeof v === 'string');

        return titles.sort(sortByTitle)[0] ?? null;
      };

      const aTitle = getFirstTagTitle(a);
      const bTitle = getFirstTagTitle(b);

      // If both with tags
      if (aTitle && bTitle) {
        // If same - sort by task title
        if (aTitle === bTitle) return sortByTitle(a.title, b.title, factor);

        // Sort by tag title
        return sortByTitle(aTitle, bTitle, factor);
      }

      // If both without tags - sort by task title
      if (!aTitle && !bTitle) return sortByTitle(a.title, b.title, factor);

      // If one task has a tag title, give it priority
      return aTitle ? -1 * factor : 1 * factor;
    };

    switch (sortType) {
      case SORT_OPTION_TYPE.name:
        return tasksCopy.sort((a, b) => sortByTitle(a.title, b.title, factor));

      case SORT_OPTION_TYPE.tag:
        return tasksCopy.sort(sortByTagTitle);

      case SORT_OPTION_TYPE.creationDate:
        return tasksCopy.sort((a, b) => (a.created - b.created) * factor);

      case SORT_OPTION_TYPE.scheduledDate:
        return tasksCopy.sort((a, b) => {
          const dateA = a.dueDay
            ? new Date(a.dueDay)
            : a.dueWithTime
              ? new Date(a.dueWithTime)
              : null;
          const dateB = b.dueDay
            ? new Date(b.dueDay)
            : b.dueWithTime
              ? new Date(b.dueWithTime)
              : null;

          if (dateA === null && dateB === null) return 0;
          if (dateA === null) return 1 * factor;
          if (dateB === null) return -1 * factor;

          return (dateA.getTime() - dateB.getTime()) * factor;
        });

      case SORT_OPTION_TYPE.estimatedTime:
        return tasksCopy.sort(
          (a, b) => ((a.timeEstimate || 0) - (b.timeEstimate || 0)) * factor,
        );

      case SORT_OPTION_TYPE.timeSpent:
        return tasksCopy.sort((a, b) => {
          const aSpent = a.timeSpentOnDay
            ? Object.values(a.timeSpentOnDay).reduce((x, y) => x + y, 0)
            : 0;
          const bSpent = b.timeSpentOnDay
            ? Object.values(b.timeSpentOnDay).reduce((x, y) => x + y, 0)
            : 0;
          return (aSpent - bSpent) * factor;
        });

      default:
        return tasksCopy;
    }
  }

  private applyGrouping(
    tasks: TaskWithSubTasks[],
    groupType: GROUP_OPTION_TYPE | null,
  ): Record<string, TaskWithSubTasks[]> {
    return tasks.reduce(
      (acc, task) => {
        if (groupType === GROUP_OPTION_TYPE.tag) {
          if (task.tagIds && task.tagIds.length > 0) {
            task.tagIds.forEach((tagId) => {
              const tag = this._allTags.find((t) => t.id === tagId);
              const key = tag ? tag.title : 'Unknown tag';
              acc[key] = acc[key] || [];
              acc[key].push(task);
            });
          } else {
            acc['No tag'] = acc['No tag'] || [];
            acc['No tag'].push(task);
          }
        } else if (groupType === GROUP_OPTION_TYPE.project) {
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
        }
        return acc;
      },
      {} as Record<string, TaskWithSubTasks[]>,
    );
  }

  setSort(val: SortOption): void {
    const isSame = val.type === this.selectedSort().type;
    if (isSame) {
      // reverse sorting
      val.order = val.order === SORT_ORDER.ASC ? SORT_ORDER.DESC : SORT_ORDER.ASC;
    }
    this.selectedSort.set({ ...val });
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

  async sortPermanent(sort: SortOption | null): Promise<void> {
    if (!sort) {
      this.resetAll();
      return;
    }

    const workContextId = this._workContextService.activeWorkContextId;
    const workContextType = this._workContextService.activeWorkContextType;
    if (!workContextId || !workContextType) {
      this.resetAll();
      return;
    }

    const [todaysTasks, undoneTasks] = await Promise.all([
      this._workContextService.mainListTasks$.pipe(take(1)).toPromise(),
      this._workContextService.undoneTasks$.pipe(take(1)).toPromise(),
    ]);

    if (!todaysTasks?.length || !undoneTasks?.length) {
      this.resetAll();
      return;
    }

    const sortedTasks = this.applySort(undoneTasks, sort.type, sort.order);
    if (!sortedTasks.length) {
      this.resetAll();
      return;
    }

    const sortedIdQueue = sortedTasks.map((task) => task.id);
    const sortedIdSet = new Set(sortedIdQueue);
    const newOrderedIds = todaysTasks.map((task) => {
      if (!sortedIdSet.has(task.id)) {
        return task.id;
      }
      const nextId = sortedIdQueue.shift();
      return nextId ?? task.id;
    });

    const isOrderChanged = todaysTasks.some(
      (task, idx) => task.id !== newOrderedIds[idx],
    );
    if (!isOrderChanged) {
      this.resetAll();
      return;
    }

    if (workContextType === WorkContextType.PROJECT) {
      this._projectService.update(workContextId, { taskIds: newOrderedIds });
    } else if (workContextType === WorkContextType.TAG) {
      this._tagService.updateTag(workContextId, { taskIds: newOrderedIds });
    }

    this.resetAll();
  }
}
