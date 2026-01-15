import { inject, Injectable, WritableSignal } from '@angular/core';
import { combineLatest, forkJoin, from, Observable, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  first,
  map,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TagService } from '../../tag/tag.service';
import { ProjectService } from '../../project/project.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { Project } from '../../project/project.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { Task } from '../task.model';
import { AddTaskSuggestion } from './add-task-suggestions.model';
import { truncate } from '../../../util/truncate';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { IssueService } from '../../issue/issue.service';
import { assertTruthy } from '../../../util/assert-truthy';
import { TaskLog } from '../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class AddTaskBarIssueSearchService {
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _tagService = inject(TagService);
  private _projectService = inject(ProjectService);
  private _globalConfigService = inject(GlobalConfigService);
  private _snackService = inject(SnackService);
  private _issueService = inject(IssueService);

  getFilteredIssueSuggestions$(
    inputText$: Observable<string>,
    isSearchIssueProviders$: Observable<boolean>,
    isLoading: WritableSignal<boolean>,
  ): Observable<AddTaskSuggestion[]> {
    return inputText$.pipe(
      tap(() => {
        isLoading.set(false);
      }),
      debounceTime(300),
      tap(() => {
        isLoading.set(true);
      }),
      withLatestFrom(this._workContextService.activeWorkContextTypeAndId$),
      switchMap(([searchTerm, { activeType, activeId }]) =>
        isSearchIssueProviders$.pipe(
          switchMap((isSearchMode) => {
            if (!isSearchMode) {
              // When search mode is OFF, don't search anything
              return of([]);
            }

            if (!searchTerm?.length) {
              return of([]);
            }

            // When search mode is ON, search both archived tasks and issues
            const archivedTasksSearch$ =
              activeType === WorkContextType.PROJECT
                ? this._searchForProject$(searchTerm, activeId)
                : this._searchForTag$(searchTerm, activeId);

            const issueSearch$ = this._issueService
              .searchAllEnabledIssueProviders$(searchTerm)
              .pipe(
                map((issueSuggestions) =>
                  issueSuggestions.map(
                    (issueSuggestion) =>
                      ({
                        title: issueSuggestion.title,
                        titleHighlighted: issueSuggestion.titleHighlighted,
                        issueData: issueSuggestion.issueData,
                        issueType: issueSuggestion.issueType,
                        issueProviderId: issueSuggestion.issueProviderId,
                      }) as AddTaskSuggestion,
                  ),
                ),
                catchError(() => of([])),
              );

            return combineLatest([archivedTasksSearch$, issueSearch$]).pipe(
              map(([tasks, issues]) => [...tasks, ...issues]),
            );
          }),
        ),
      ),
      tap(() => {
        isLoading.set(false);
      }),
      // don't show issues twice
      // NOTE: this only works because backlog items come first
      map((items: AddTaskSuggestion[]) =>
        items.reduce((unique: AddTaskSuggestion[], item: AddTaskSuggestion) => {
          return item.issueData &&
            unique.find(
              // NOTE: we check defined because we don't want to run into
              // false == false or similar
              (u) =>
                !!u.taskIssueId &&
                !!item.issueData &&
                u.taskIssueId === item.issueData.id,
            )
            ? unique
            : [...unique, item];
        }, []),
      ),
    );
  }

  async addTaskFromExistingTaskOrIssue(
    item: AddTaskSuggestion,
    isAddToBacklog: boolean,
    isAddToCurrentTag: boolean,
  ): Promise<string | undefined> {
    if (item.taskId && item.isFromOtherContextAndTagOnlySearch) {
      if (
        isAddToCurrentTag &&
        this._workContextService.activeWorkContextType === WorkContextType.TAG
      ) {
        const task = await this._taskService.getByIdOnce$(item.taskId).toPromise();
        this._taskService.moveToCurrentWorkContext(task);
      }
      this._snackService.open({
        ico: 'playlist_add',
        msg: T.F.TASK.S.FOUND_MOVE_FROM_OTHER_LIST,
        translateParams: {
          title: truncate(item.title),
          contextTitle:
            item.ctx && item.ctx.title ? truncate(item.ctx.title) : '~the void~',
        },
      });
      return item.taskId;
    } else if (item.taskId) {
      if (!item.projectId) {
        TaskLog.log(item);
        throw new Error('Weird add task case1');
      }
      this._projectService.moveTaskToTodayList(item.taskId, item.projectId);
      this._snackService.open({
        ico: 'arrow_upward',
        msg: T.F.TASK.S.FOUND_MOVE_FROM_BACKLOG,
        translateParams: { title: item.title },
      });
      return item.taskId;
    } else {
      if (!item.issueType || !item.issueData) {
        throw new Error('No issueData');
      }

      const res = await this._taskService.checkForTaskWithIssueEverywhere(
        item.issueData.id,
        item.issueType,
        this._workContextService.activeWorkContextId as string,
      );
      TaskLog.log(res);
      if (!res) {
        return await this._issueService.addTaskFromIssue({
          issueProviderKey: item.issueType,
          issueProviderId: assertTruthy(item.issueProviderId),
          issueDataReduced: assertTruthy(item.issueData),
          isAddToBacklog: isAddToBacklog,
        });
      } else if (res.isFromArchive) {
        this._taskService.restoreTask(res.task, res.subTasks || []);
        this._snackService.open({
          ico: 'info',
          msg: T.F.TASK.S.FOUND_RESTORE_FROM_ARCHIVE,
          translateParams: { title: res.task.title },
        });
        return res.task.id;
      } else if (res.task.projectId) {
        this._projectService.moveTaskToTodayList(res.task.id, res.task.projectId);
        this._snackService.open({
          ico: 'arrow_upward',
          msg: T.F.TASK.S.FOUND_MOVE_FROM_BACKLOG,
          translateParams: { title: res.task.title },
        });
        return res.task.id;
      } else {
        throw new Error('Weird add task case2');
      }
    }
  }

  private _searchForProject$(
    searchTerm: string,
    projectId: string,
  ): Observable<AddTaskSuggestion[]> {
    if (searchTerm && searchTerm.length > 0) {
      return this._workContextService.backlogTasks$.pipe(
        map((tasks) =>
          tasks
            .filter((task) => this._filterBacklog(searchTerm, task))
            .map((task) => ({
              title: task.title,
              taskId: task.id,
              projectId,
              taskIssueId: task.issueId || undefined,
              issueType: task.issueType || undefined,
            })),
        ),
      );
    } else {
      return of([]);
    }
  }

  private _searchForTag$(
    searchTerm: string,
    currentTagId: string,
  ): Observable<AddTaskSuggestion[]> {
    if (searchTerm && searchTerm.length > 0) {
      return this._taskService.getAllParentWithoutTag$(currentTagId).pipe(
        take(1),
        map((tasks) =>
          tasks
            .filter((task) => this._filterBacklog(searchTerm, task))
            .map((task) => ({
              title: task.title,
              taskId: task.id,
              taskIssueId: task.issueId || undefined,
              issueType: task.issueType || undefined,
              projectId: task.projectId,
              isFromOtherContextAndTagOnlySearch: true,
              tagIds: task.tagIds,
            })),
        ),
        switchMap((tasks) =>
          !!tasks.length
            ? forkJoin(
                tasks.map((task) => {
                  return from(this._getCtxForTaskSuggestion(task)).pipe(
                    first(),
                    map((ctx) => ({
                      ...task,
                      ctx: {
                        ...ctx,
                        icon: (ctx && ctx.icon) || null,
                      },
                    })),
                  );
                }),
              )
            : of([]),
        ),
      );
    } else {
      return of([]);
    }
  }

  private _filterBacklog(searchText: string, task: Task): boolean {
    try {
      return !!task.title.toLowerCase().match(searchText.toLowerCase());
    } catch (e) {
      TaskLog.err('RegEx Error', e);
      return false;
    }
  }

  private async _getCtxForTaskSuggestion({
    projectId,
  }: AddTaskSuggestion): Promise<Project> {
    return await this._projectService.getByIdOnce$(projectId).toPromise();
  }
}
