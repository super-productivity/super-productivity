import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import {
  EMPTY,
  Observable,
  first,
  firstValueFrom,
  from,
  lastValueFrom,
  merge,
  timer,
} from 'rxjs';
import {
  catchError,
  concatMap,
  filter,
  finalize,
  map,
  mergeMap,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { REMOTE_ISSUE_DELETE_DEFER_MS } from '../../../app.constants';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { isWontDoTask } from '../../tasks/util/is-wont-do-task';
import { selectAllTasks, selectTaskEntities } from '../../tasks/store/task.selectors';
import { IssueProviderService } from '../issue-provider.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import {
  computePushDecisions,
  issueValuesEqual,
  pushedValuesToCarry,
} from './compute-push-decisions';
import { FieldMapping, FieldSyncConfig, IssueSyncPushError } from './issue-sync.model';
import { computePendingLocalChanges } from './compute-field-pull';
import { IssueSyncFailure, IssueSyncStateService } from './issue-sync-state.service';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { IssueProvider, IssueProviderCaldav, IssueProviderKey } from '../issue.model';
import { PLAINSPACE_TYPE } from '../issue.const';
import { IssueLog } from '../../../core/log';
import { HttpErrorResponse } from '@angular/common/http';
import { CaldavSyncAdapterService } from '../providers/caldav/caldav-sync-adapter.service';
import { PlainspaceSyncAdapterService } from '../providers/plainspace/plainspace-sync-adapter.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import {
  DeletedTaskIssueSidecarService,
  DeletedTaskIssueInfo,
} from './deleted-task-issue-sidecar.service';
import { DeletedTagTitlesSidecarService } from './deleted-tag-titles-sidecar.service';
import { PendingRemoteIssueDeleteService } from './pending-remote-issue-delete.service';
import { selectEnabledIssueProviders } from '../store/issue-provider.selectors';
import { getErrorTxt } from '../../../util/get-error-text';
import { T } from '../../../t.const';
import { PlannerActions } from '../../planner/store/planner.actions';
import { deleteTag, deleteTags } from '../../tag/store/tag.actions';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';
import { shortSyntaxForNewWords } from '../../tasks/util/short-syntax-for-new-words';
import { IssueSharedTitleService } from './issue-shared-title.service';
import { selectShortSyntaxConfig } from '../../config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { selectAllTagsWithoutMyDay } from '../../tag/store/tag.reducer';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';

const SYNCABLE_TASK_FIELDS: ReadonlySet<string> = new Set([
  'isDone',
  'title',
  'notes',
  'dueWithTime',
  'dueDay',
  'deadlineDay',
  'deadlineWithTime',
  'timeEstimate',
  'tagIds',
]);

/**
 * A provider's write may reject with this marker to signal an *expected*
 * limitation rather than a real failure — e.g. the CalDAV plugin can't yet edit
 * or delete a single occurrence of a recurring event (#7492). When it does,
 * two-way sync stays silent: the user changed/removed their task, not the
 * calendar. Explicit calendar actions (agenda reschedule/delete) don't consult
 * this and still surface the message, which is the honest feedback there.
 */
const isExpectedSyncSkipError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { isExpectedSyncSkip?: boolean }).isExpectedSyncSkip === true;

// Log history is exportable and an HTTP error carries the provider's URL and
// the item id: log its status only.
const toLoggableError = (err: unknown): unknown =>
  err instanceof HttpErrorResponse ? { status: err.status } : err;

const toSortedStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string')
        .slice()
        .sort()
    : [];

// Lookup map to extract taskId and changes from each action type,
// replacing chained if/else with manual casts.
const ACTION_EXTRACTORS: Record<
  string,
  (action: unknown) => { taskId: string; changes: Record<string, unknown> }
> = {
  [TaskSharedActions.applyShortSyntax.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.applyShortSyntax>;
    const changes: Record<string, unknown> = { ...a.taskChanges };
    if (a.schedulingInfo?.dueWithTime) {
      changes['dueWithTime'] = a.schedulingInfo.dueWithTime;
    }
    if (a.schedulingInfo?.day) {
      changes['dueDay'] = a.schedulingInfo.day;
    }
    return { taskId: a.task.id, changes };
  },
  [TaskSharedActions.scheduleTaskWithTime.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>;
    return { taskId: a.task.id, changes: { dueWithTime: a.dueWithTime } };
  },
  [TaskSharedActions.reScheduleTaskWithTime.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.reScheduleTaskWithTime>;
    return { taskId: a.task.id, changes: { dueWithTime: a.dueWithTime } };
  },
  [TaskSharedActions.unscheduleTask.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.unscheduleTask>;
    return { taskId: a.id, changes: { dueWithTime: undefined } };
  },
  [TaskSharedActions.updateTask.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.updateTask>;
    return {
      taskId: a.task.id.toString(),
      changes: a.task.changes as Partial<Task>,
    };
  },
  [TaskSharedActions.addTagToTask.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.addTagToTask>;
    return { taskId: a.taskId, changes: { tagIds: undefined } };
  },
  [PlannerActions.planTaskForDay.type]: (action) => {
    const a = action as ReturnType<typeof PlannerActions.planTaskForDay>;
    return { taskId: a.task.id, changes: { dueDay: a.day } };
  },
  [PlannerActions.transferTask.type]: (action) => {
    const a = action as ReturnType<typeof PlannerActions.transferTask>;
    return { taskId: a.task.id, changes: { dueDay: a.newDay } };
  },
};

const omitIsDone = (changes: Partial<Task>): Partial<Task> => {
  const rest = { ...changes };
  delete rest.isDone;
  return rest;
};

interface AutoCreateTrigger {
  task: Task;
  isIgnoreShortSyntax?: boolean;
  /** Set for a move-in (#8790): the project the task was moved into. */
  moveInProjectId: string | undefined;
}

@Injectable()
export class IssueTwoWaySyncEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _adapterRegistry = inject(IssueSyncAdapterRegistryService);
  private readonly _snackService = inject(SnackService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  private readonly _deletedTaskIssueSidecar = inject(DeletedTaskIssueSidecarService);
  private readonly _pendingRemoteIssueDelete = inject(PendingRemoteIssueDeleteService);
  private readonly _deletedTagTitlesSidecar = inject(DeletedTagTitlesSidecarService);
  private readonly _adapterResolver = inject(IssueSyncAdapterResolverService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _syncState = inject(IssueSyncStateService);
  private readonly _issueSharedTitleService = inject(IssueSharedTitleService);
  private readonly _taskEntities = this._store.selectSignal(selectTaskEntities);
  private _syncOriginatedTaskIds = new Set<string>();
  private static readonly _MAX_SYNC_ORIGINATED_IDS = 1000;

  constructor() {
    const caldavAdapter = inject(CaldavSyncAdapterService);
    this._adapterRegistry.register('CALDAV', caldavAdapter);
    const plainspaceAdapter = inject(PlainspaceSyncAdapterService);
    this._adapterRegistry.register('PLAINSPACE', plainspaceAdapter);
  }

  /**
   * Pushes a task's synced fields: on a local edit, and on request for the
   * edits still pending against the baseline — found by a successful poll
   * (quiet), asked for by Retry, or ahead of a handoff, which waits for the
   * outcome (`onDone`). One stream, so pushes of a task stay in order. A task
   * its provider no longer lists for me is not pushed.
   */
  pushFieldsOnTaskUpdate$: Observable<unknown> = createEffect(
    () =>
      merge(
        this._actions$.pipe(
          ofType(
            TaskSharedActions.updateTask,
            TaskSharedActions.applyShortSyntax,
            TaskSharedActions.scheduleTaskWithTime,
            TaskSharedActions.reScheduleTaskWithTime,
            TaskSharedActions.unscheduleTask,
            TaskSharedActions.addTagToTask,
            PlannerActions.planTaskForDay,
            PlannerActions.transferTask,
          ),
          map((action) => ({ action, ...ACTION_EXTRACTORS[action.type](action) })),
          filter(({ taskId, changes }) => {
            if (this._syncOriginatedTaskIds.delete(taskId)) {
              return false;
            }
            // Skip poll-originated updates that include sync bookkeeping fields
            if ('issueLastSyncedValues' in changes || 'issueWasUpdated' in changes) {
              return false;
            }
            return Object.keys(changes).some((key) => SYNCABLE_TASK_FIELDS.has(key));
          }),
          // Short syntax typed into a title is applied right after this update,
          // and the applyShortSyntax that follows pushes the cleaned title.
          // Pushing this raw one first would show the tokens in the provider.
          // After the filter above: its sync-originated check must stay in step
          // with dispatch, which an async step ahead of it would break.
          concatMap((x) =>
            // A parse that fails (e.g. the date parser chunk can't load) pushes
            // the title as typed rather than stopping the push stream.
            from(this._isTitleAboutToBeRewritten(x.action).catch(() => false)).pipe(
              filter((isRewritten) => !isRewritten),
              map(() => x),
            ),
          ),
          map(({ taskId, changes }) => ({
            taskId,
            changes: changes as Partial<Task> | null,
            isSilent: false,
            onDone: undefined as ((isPushed: boolean) => void) | undefined,
          })),
        ),
        this._syncState.pushRequests$.pipe(
          map(({ taskId, isSilent, onDone }) => ({
            taskId,
            changes: null as Partial<Task> | null,
            isSilent,
            onDone,
          })),
        ),
      ).pipe(
        concatMap(({ taskId, changes, isSilent, onDone }) =>
          this._taskService.getByIdOnce$(taskId).pipe(
            map((fullTask) => ({
              fullTask,
              changes,
              isSilent,
              onDone,
            })),
          ),
        ),
        filter(({ fullTask, onDone }) => {
          const isPushable =
            !!fullTask?.issueType &&
            !!fullTask.issueProviderId &&
            !!fullTask.issueId &&
            !!this._getAdapter(fullTask.issueType) &&
            !this._syncState.isMissing(fullTask.id);
          if (!isPushable) {
            // Nothing this effect would push.
            onDone?.(true);
          }
          return isPushable;
        }),
        concatMap(({ fullTask, changes, isSilent, onDone }) =>
          (changes
            ? this._pushChanges$(fullTask, changes)
            : this._pushPendingChanges$(fullTask)
          ).pipe(
            tap({
              complete: () => {
                this._syncState.clearFailure(fullTask.id);
                onDone?.(true);
              },
            }),
            catchError((err) => {
              // Expected provider limitation (e.g. a single recurring occurrence,
              // #7492) — the local task edit stands; don't alarm the user.
              if (isExpectedSyncSkipError(err)) {
                this._syncState.clearFailure(fullTask.id);
                onDone?.(true);
                return EMPTY;
              }
              IssueLog.err('Two-way sync push failed', toLoggableError(err));
              const failure = this._toSyncFailure(err);
              this._syncState.reportFailure(fullTask.id, failure);
              onDone?.(false);
              // A poll retries every few minutes; its failure shows on the task.
              if (!isSilent) {
                this._snackService.open(
                  'msgKey' in failure
                    ? { type: 'ERROR', msg: failure.msgKey }
                    : {
                        type: 'ERROR',
                        msg: T.F.ISSUE.S.TWO_WAY_SYNC_PUSH_FAILED,
                        translateParams: { errorMsg: failure.text },
                      },
                );
              }
              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  pushTagChangesAfterTagDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(deleteTag, deleteTags),
        // Titles arrive via sidecar (set by TagService before dispatch), not
        // on the action payload — keeps user-visible tag titles out of the
        // exportable op-log.
        map(() => this._deletedTagTitlesSidecar.consume()),
        filter((deletedTagTitles) => deletedTagTitles.length > 0),
        concatMap((deletedTagTitles) =>
          this._store.select(selectAllTasks).pipe(
            first(),
            map((tasks) =>
              tasks.filter((task) =>
                this._isTaskAffectedByDeletedTagTitles(task, deletedTagTitles),
              ),
            ),
            concatMap((tasks) => from(tasks)),
          ),
        ),
        filter((task) => {
          if (this._syncOriginatedTaskIds.delete(task.id)) {
            return false;
          }
          if (!task.issueType || !task.issueProviderId || !task.issueId) {
            return false;
          }
          return !!this._getAdapter(task.issueType);
        }),
        concatMap((task) =>
          this._pushChanges$(task, { tagIds: task.tagIds }).pipe(
            catchError((err) => {
              if (isExpectedSyncSkipError(err)) {
                return EMPTY;
              }
              IssueLog.err('Two-way sync tag delete push failed', toLoggableError(err));
              this._snackService.open({
                type: 'ERROR',
                msg: T.F.ISSUE.S.TWO_WAY_SYNC_PUSH_FAILED,
                translateParams: { errorMsg: getErrorTxt(err) },
              });
              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  deleteIssueOnTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        filter(
          ({ task }) => !!task.issueId && !!task.issueType && !!task.issueProviderId,
        ),
        filter(({ task }) => !!this._getAdapter(task.issueType!)),
        // restoreDeletedTask can undo the local delete; nothing can undo the
        // remote one, so it waits out the undo window. mergeMap rather than
        // concatMap, or N deletes would queue up N windows.
        // shortcut: in-memory timer — quitting inside the window drops the
        // remote delete (orphaned remote item); persist pending deletes if
        // that is reported.
        // A poll inside the window must not import the item again.
        tap(({ task }) =>
          this._pendingRemoteIssueDelete.add(task.issueProviderId!, task.issueId!),
        ),
        mergeMap(({ task }) =>
          timer(REMOTE_ISSUE_DELETE_DEFER_MS).pipe(
            // Both the snack's UNDO and a restore from "Recently deleted"
            // inside the window must keep the remote issue.
            takeUntil(
              this._actions$.pipe(
                ofType(
                  TaskSharedActions.restoreDeletedTask,
                  TaskSharedActions.restoreTask,
                ),
                filter(({ task: restored }) => restored.id === task.id),
              ),
            ),
            concatMap(() => this._deleteRemoteIssue$(task)),
            // The provider can be removed inside the window; getCfgOnce$ then
            // throws, and an escaped error would tear down every other pending
            // deferred delete.
            catchError((err) => {
              IssueLog.err('Deferred remote issue delete failed', toLoggableError(err));
              return EMPTY;
            }),
            finalize(() =>
              this._pendingRemoteIssueDelete.remove(task.issueProviderId!, task.issueId!),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  deleteIssueOnBulkTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTasks),
        concatMap(() => {
          const issueInfos = this._deletedTaskIssueSidecar
            .consume()
            .filter((info) => !!this._getAdapter(info.issueType));
          if (!issueInfos.length) {
            return EMPTY;
          }
          // The items are deleted one by one: a poll meanwhile must not import
          // the ones still to come.
          issueInfos.forEach((info) =>
            this._pendingRemoteIssueDelete.add(info.issueProviderId, info.issueId),
          );
          return from(issueInfos).pipe(
            concatMap((info) =>
              this._deleteRemoteIssue$(info).pipe(
                // The provider can be removed meanwhile (getCfgOnce$ throws): an
                // escaped error would skip the rest and end this effect.
                catchError((err) => {
                  IssueLog.err('Bulk remote issue delete failed', toLoggableError(err));
                  return EMPTY;
                }),
                finalize(() =>
                  this._pendingRemoteIssueDelete.remove(
                    info.issueProviderId,
                    info.issueId,
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    { dispatch: false },
  );

  /**
   * Creates and links the remote issue for a new root task in a project bound
   * to a provider with auto-create, and (Plainspace only, #8790) for a root
   * task moved into a Plainspace-bound project: by the move action or by
   * `+Project` short syntax on an existing task. A move-in reads the task from
   * the store when its turn comes, so a task whose create is still in flight
   * (one serial stream) is linked by then and not created twice. Moving a
   * linked task out keeps its link. A failed create snacks and leaves the task
   * unlinked; creates are never retried automatically.
   */
  autoCreateIssueOnTaskAdd$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.addTask,
          TaskSharedActions.moveToOtherProject,
          TaskSharedActions.applyShortSyntax,
        ),
        map((action) => this._toAutoCreateTrigger(action)),
        filter((trigger): trigger is AutoCreateTrigger => !!trigger),
        concatMap(({ task: triggerTask, isIgnoreShortSyntax, moveInProjectId }) =>
          // Resolved inside the serial stage, after earlier creates linked.
          this._resolveAutoCreateTask$(triggerTask, moveInProjectId).pipe(
            filter((task): task is Task => !!task && !task.parentId && !!task.projectId),
            concatMap((task) =>
              this._store.select(selectEnabledIssueProviders).pipe(
                first(),
                map((providers) =>
                  providers.find(
                    (p) =>
                      p.defaultProjectId === task.projectId &&
                      (!moveInProjectId || p.issueProviderKey === PLAINSPACE_TYPE) &&
                      this._hasAutoCreateEnabled(p, task),
                  ),
                ),
                filter((provider): provider is IssueProvider => !!provider),
                concatMap((provider) => {
                  const adapter = this._getAdapter(provider.issueProviderKey);
                  if (!adapter?.createIssue) {
                    return EMPTY;
                  }
                  return this._issueProviderService
                    .getCfgOnce$(provider.id, provider.issueProviderKey)
                    .pipe(
                      concatMap((cfg) =>
                        from(this._parseShortSyntax(task, isIgnoreShortSyntax)).pipe(
                          // `+OtherProject` moves the task out of the bound project
                          // right after this add; its issue would land in the wrong
                          // tracker.
                          filter(
                            ({ projectId }) => !projectId || projectId === task.projectId,
                          ),
                          concatMap(({ title }) =>
                            // Check the task as it is now, not the add's snapshot:
                            // the add-task bar attaches a repeat right after the
                            // add, and the task can be deleted or linked while the
                            // title parses.
                            this._taskService.getByIdOnce$(task.id).pipe(
                              filter(
                                (current) =>
                                  !!current &&
                                  !current.issueId &&
                                  this._hasAutoCreateEnabled(provider, current),
                              ),
                              concatMap(() =>
                                from(
                                  adapter.createIssue!(title, cfg, { taskId: task.id }),
                                ),
                              ),
                              map((created) => ({ ...created, title })),
                            ),
                          ),
                          concatMap(
                            async ({ issueId, issueNumber, issueData, title }) => {
                              // Keep a title that changed since the add (short syntax
                              // landed, or the user renamed it during the round-trip);
                              // never write the action's raw snapshot back.
                              const currentTask = await firstValueFrom(
                                this._taskService.getByIdOnce$(task.id),
                              );
                              if (!currentTask) {
                                // Deleted while the issue was created: nothing is
                                // left to link, so treat the new issue like the
                                // task's own (the provider's delete setting decides).
                                await lastValueFrom(
                                  this._deleteRemoteIssue$({
                                    issueId,
                                    issueType: provider.issueProviderKey,
                                    issueProviderId: provider.id,
                                  }),
                                  { defaultValue: undefined },
                                );
                                return;
                              }
                              this._trackSyncOriginatedTask(task.id);
                              try {
                                const titlePrefix =
                                  issueNumber != null ? `#${issueNumber} ` : '';
                                const syncValues = adapter.extractSyncValues(issueData);
                                const localTitle =
                                  currentTask.title !== task.title
                                    ? currentTask.title
                                    : title;
                                this._taskService.update(task.id, {
                                  issueId,
                                  issueType: provider.issueProviderKey,
                                  issueProviderId: provider.id,
                                  // The provider's own freshness marker (CalDAV: an ETag
                                  // hash), or the first poll reads the new issue as
                                  // remotely updated.
                                  issueLastUpdated:
                                    adapter.getIssueLastUpdated?.(issueData) ??
                                    Date.now(),
                                  issueWasUpdated: false,
                                  issueLastSyncedValues: syncValues,
                                  title: titlePrefix
                                    ? `${titlePrefix}${localTitle}`
                                    : localTitle,
                                });

                                // Push initial task values (e.g. dueWithTime from short syntax)
                                // that were set before the issue was linked
                                await this._pushInitialValues(
                                  task,
                                  issueId,
                                  adapter,
                                  cfg,
                                  syncValues,
                                );
                              } catch (e) {
                                this._syncOriginatedTaskIds.delete(task.id);
                                throw e;
                              }
                            },
                          ),
                        ),
                      ),
                    );
                }),
                catchError((err) => {
                  // The create and link succeeded; the provider declined an
                  // initial value it can't take (an older Plainspace server and
                  // a time), and says so itself.
                  if (isExpectedSyncSkipError(err)) {
                    return EMPTY;
                  }
                  IssueLog.err('Auto-create issue failed', toLoggableError(err));
                  this._snackService.open({
                    type: 'ERROR',
                    msg: T.F.ISSUE.S.AUTO_CREATE_FAILED,
                    translateParams: { errorMsg: getErrorTxt(err) },
                  });
                  return EMPTY;
                }),
              ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /** What an action asks the create stage to do, or null for nothing. */
  private _toAutoCreateTrigger(
    action: ReturnType<
      | typeof TaskSharedActions.addTask
      | typeof TaskSharedActions.moveToOtherProject
      | typeof TaskSharedActions.applyShortSyntax
    >,
  ): AutoCreateTrigger | null {
    if (action.type === TaskSharedActions.addTask.type) {
      return !action.task.issueId && !action.issue
        ? {
            task: action.task,
            isIgnoreShortSyntax: action.isIgnoreShortSyntax,
            moveInProjectId: undefined,
          }
        : null;
    }
    // moveToOtherProject, or applyShortSyntax with a `+Project` move. A "move"
    // to the project the task is already in is no move-in.
    return action.targetProjectId && action.targetProjectId !== action.task.projectId
      ? {
          task: action.task,
          // The title was typed earlier; a move never parses it again.
          isIgnoreShortSyntax: true,
          moveInProjectId: action.targetProjectId,
        }
      : null;
  }

  /**
   * The task to create an issue for: the added task as dispatched, or for a
   * move-in the task as it is now, if it still sits in the target project.
   * Linked or deleted tasks are skipped by the re-read right before the create.
   */
  private _resolveAutoCreateTask$(
    task: Task,
    moveInProjectId: string | undefined,
  ): Observable<Task | undefined> {
    if (!moveInProjectId) {
      return from([task]);
    }
    return this._taskService
      .getByIdOnce$(task.id)
      .pipe(
        map((current) =>
          current && current.projectId === moveInProjectId ? current : undefined,
        ),
      );
  }

  /**
   * Whether the short-syntax effect is about to rewrite the title of this
   * update: it parses an update that changes only the title, like this does.
   */
  private async _isTitleAboutToBeRewritten(action: { type: string }): Promise<boolean> {
    if (action.type !== TaskSharedActions.updateTask.type) {
      return false;
    }
    const { task, isIgnoreShortSyntax } = action as ReturnType<
      typeof TaskSharedActions.updateTask
    >;
    const changedKeys = Object.keys(task.changes);
    if (isIgnoreShortSyntax || changedKeys.length !== 1 || changedKeys[0] !== 'title') {
      return false;
    }
    const current = await firstValueFrom(this._taskService.getByIdOnce$(String(task.id)));
    if (!current?.issueId) {
      return false;
    }
    const sharedTitle = await this._issueSharedTitleService.getSharedTitle(current);
    return (
      (await this._parseShortSyntax(current, false, sharedTitle)).title !== current.title
    );
  }

  /**
   * The short-syntax effect cleans the title on the same addTask, but its parse
   * is async (lazy date-parser import) and nothing orders it against this
   * effect. Parse here with the same inputs so the remote issue is never
   * created with the raw tokens (#10024).
   */
  private async _parseShortSyntax(
    task: Task,
    isIgnoreShortSyntax?: boolean,
    // A shared title whose words stay text (see IssueSharedTitleService).
    keptTitle?: string,
  ): Promise<{ title: string; projectId?: string }> {
    if (isIgnoreShortSyntax) {
      return { title: task.title };
    }
    const [cfg, tags, projects] = await Promise.all([
      firstValueFrom(this._store.select(selectShortSyntaxConfig)),
      firstValueFrom(this._store.select(selectAllTagsWithoutMyDay)),
      firstValueFrom(this._store.select(selectUnarchivedProjects)),
    ]);
    const r = await shortSyntaxForNewWords(
      keptTitle,
      task,
      cfg || DEFAULT_GLOBAL_CONFIG.shortSyntax,
      tags,
      projects,
      undefined,
      'combine',
      false,
      this._dateTimeFormatService.dateInputLocale(),
    );
    return { title: r?.taskChanges.title ?? task.title, projectId: r?.projectId };
  }

  private async _pushInitialValues(
    task: Task,
    issueId: string,
    adapter: {
      getFieldMappings(): FieldMapping[];
      getSyncConfig(cfg: unknown): FieldSyncConfig;
      pushChanges(
        issueId: string,
        changes: Record<string, unknown>,
        cfg: unknown,
      ): Promise<unknown>;
      fetchIssue(issueId: string, cfg: unknown): Promise<Record<string, unknown>>;
      getIssueLastUpdated?(issue: Record<string, unknown>): number;
    },
    cfg: IssueProvider,
    syncValues: Record<string, unknown>,
  ): Promise<void> {
    // Re-fetch task from the store to get post-meta-reducer values
    // (e.g. dueWithTime from short syntax parsing like @2pm)
    const currentTask = await firstValueFrom(this._taskService.getByIdOnce$(task.id));
    const fieldMappings = adapter.getFieldMappings();
    const syncConfig = adapter.getSyncConfig(cfg);
    const ctx = { issueId };
    const toPush: Record<string, unknown> = {};

    for (const mapping of fieldMappings) {
      const dir = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
      if (dir !== 'pushOnly' && dir !== 'both') {
        continue;
      }
      // As in _pushChanges$: a won't-do task was not completed.
      if (mapping.taskField === 'isDone' && isWontDoTask(currentTask)) {
        continue;
      }
      const taskValue = currentTask[mapping.taskField as keyof Task];
      if (taskValue == null) {
        continue;
      }
      const issueValue = mapping.toIssueValue(taskValue, ctx);
      if (issueValue == null) {
        continue;
      }
      // Only push if task value differs from the created issue value
      if (issueValue !== syncValues[mapping.issueField]) {
        toPush[mapping.issueField] = issueValue;
      }
    }

    if (Object.keys(toPush).length > 0) {
      const writtenIssue = await adapter.pushChanges(issueId, toPush, cfg);
      // Update sync baseline and issueLastUpdated to prevent poll from
      // treating our own push as an external update
      const updatedSyncValues = { ...syncValues, ...toPush };
      // The push changed the provider's marker (CalDAV: a new ETag); take it
      // from the write's own answer when the adapter returns one, else read it
      // back, so the next poll compares against our own write.
      // A failed read-back must not turn a done create into a failed one; the
      // poll then sees a changed marker and only pulls fields that changed.
      const issueLastUpdated = !adapter.getIssueLastUpdated
        ? Date.now()
        : writtenIssue && typeof writtenIssue === 'object'
          ? adapter.getIssueLastUpdated(writtenIssue as Record<string, unknown>)
          : await adapter
              .fetchIssue(issueId, cfg)
              .then((issue) => adapter.getIssueLastUpdated!(issue))
              .catch((err) => {
                IssueLog.err(
                  'Reading the issue back after the initial push failed',
                  toLoggableError(err),
                );
                return Date.now();
              });
      // One updateTaskUi with the pushed values, as in _pushChanges$.
      this._taskService.updateUi(task.id, {
        ...pushedValuesToCarry(this._taskEntities()[task.id], toPush, fieldMappings, ctx),
        issueLastSyncedValues: updatedSyncValues,
        issueLastUpdated,
      });
    }
  }

  private _hasAutoCreateEnabled(provider: IssueProvider, task: Task): boolean {
    // Agenda-view providers (e.g. Google Calendar) should never auto-create issues
    if (this._pluginRegistry.getUseAgendaView(provider.issueProviderKey)) {
      return false;
    }
    // Plainspace-backed projects are collaborative by definition: a task added
    // there is pushed up so the team sees it (symmetric with auto-import). The
    // bound provider is itself the opt-in, so there is no separate flag — but
    // only once it is actually configured. An enabled-but-unbound provider
    // (mid-connect, spaceId/token still null) would otherwise POST an invalid
    // create and error-snack on every add; skip silently until it's ready.
    if (provider.issueProviderKey === 'PLAINSPACE') {
      const ps = provider as { spaceId?: string | null; token?: string | null };
      return !!ps.spaceId && !!ps.token;
    }
    // CalDAV writes to the user's real calendar, so it needs its own opt-in.
    // Repeat instances stay local: each one would otherwise add a VTODO.
    if (provider.issueProviderKey === 'CALDAV') {
      return (
        !!(provider as IssueProviderCaldav).twoWaySync?.createOnServer &&
        !task.repeatCfgId
      );
    }
    // Check for plugin providers (both plugin:* and migrated keys like GITHUB)
    const pluginCfg = (provider as { pluginConfig?: Record<string, unknown> })
      .pluginConfig;
    if (pluginCfg) {
      return !!(pluginCfg as Record<string, unknown>)?.['isAutoCreateIssues'];
    }
    return false;
  }

  private _isTaskAffectedByDeletedTagTitles(
    task: Task,
    deletedTagTitles: string[],
  ): boolean {
    if (!task.issueType || !task.issueId || !task.issueLastSyncedValues) {
      return false;
    }

    const adapter = this._getAdapter(task.issueType);
    if (!adapter) {
      return false;
    }

    const deletedTitleSet = new Set(deletedTagTitles);
    const parsed = parseInt(task.issueId, 10);
    const ctx = {
      issueId: task.issueId,
      issueNumber: Number.isNaN(parsed) ? undefined : parsed,
    };

    for (const mapping of adapter.getFieldMappings()) {
      if (mapping.taskField !== 'tagIds') {
        continue;
      }
      const lastValue = task.issueLastSyncedValues[mapping.issueField];
      const labels = toSortedStringArray(
        lastValue != null ? mapping.toTaskValue(lastValue, ctx) : [],
      );
      if (labels.some((label) => deletedTitleSet.has(label))) {
        return true;
      }
    }

    return false;
  }

  private _getAdapter(issueType: string): IssueSyncAdapter<unknown> | undefined {
    return this._adapterResolver.getAdapter(issueType);
  }

  private _deleteRemoteIssue$(info: DeletedTaskIssueInfo | Task): Observable<unknown> {
    if (!info.issueType || !info.issueProviderId || !info.issueId) {
      return EMPTY;
    }
    const issueType = info.issueType;
    const issueProviderId = info.issueProviderId;
    const issueId = info.issueId;
    const adapter = this._adapterRegistry.get(issueType);
    if (!adapter?.deleteIssue) {
      return EMPTY;
    }
    return this._issueProviderService
      .getCfgOnce$(issueProviderId, issueType as IssueProviderKey)
      .pipe(
        concatMap((cfg) =>
          from(adapter.deleteIssue!(issueId, cfg)).pipe(
            catchError((err) => {
              // Expected provider limitation (e.g. a single recurring occurrence,
              // #7492) — the local task is already removed; stay silent.
              if (isExpectedSyncSkipError(err)) {
                return EMPTY;
              }
              // 404/410 means the remote issue is already gone — treat as success
              // to avoid false "delete failed" toasts (e.g. when polling detects
              // a remote deletion and then deleteIssue is called on the same issue)
              const status = err instanceof HttpErrorResponse ? err.status : err?.status;
              if (status === 404 || status === 410) {
                return EMPTY;
              }
              IssueLog.err('Delete remote issue failed', toLoggableError(err));
              this._snackService.open({
                type: 'ERROR',
                msg: T.F.ISSUE.S.DELETE_REMOTE_FAILED,
              });
              return EMPTY;
            }),
          ),
        ),
      );
  }

  private _pushChanges$(task: Task, changesIn: Partial<Task>): Observable<unknown> {
    if (!task.issueType || !task.issueProviderId || !task.issueId) {
      return EMPTY;
    }
    // A won't-do task was not completed, so its `isDone` is never pushed.
    const changes = isWontDoTask(task) ? omitIsDone(changesIn) : changesIn;
    const issueType = task.issueType as IssueProviderKey;
    const issueProviderId = task.issueProviderId;
    const issueId = task.issueId;
    const adapter = this._getAdapter(issueType);
    if (!adapter) {
      return EMPTY;
    }

    return this._issueProviderService.getCfgOnce$(issueProviderId, issueType).pipe(
      concatMap(async (cfg) => {
        const fieldMappings = adapter.getFieldMappings();
        const syncConfig = adapter.getSyncConfig(cfg);

        // Early exit: check if any changed field is pushable before fetching
        const hasPushableField = fieldMappings.some((m) => {
          if (!(m.taskField in changes)) {
            return false;
          }
          const dir = syncConfig[m.taskField] ?? m.defaultDirection;
          return dir === 'pushOnly' || dir === 'both';
        });
        if (!hasPushableField) {
          return;
        }

        const freshIssue = await adapter.fetchIssue(issueId, cfg);
        const freshValues = adapter.extractSyncValues(freshIssue);
        // Decide on the item as it is now (e.g. it became repeating).
        const issueSyncConfig = adapter.getSyncConfig(cfg, freshIssue);
        // Re-fetch task to get post-meta-reducer values (e.g. short syntax parsed title)
        const currentTask = await firstValueFrom(this._taskService.getByIdOnce$(task.id));
        // the snapshot predates pushes queued before it; their baseline is newer
        const syncState = currentTask ?? task;
        const lastSyncedValues = syncState.issueLastSyncedValues ?? {};
        const taskFieldChanges: Record<string, unknown> = {};
        for (const mapping of fieldMappings) {
          if (mapping.taskField in changes) {
            // Use the current task value (post-parsing), not the raw action
            // value, also when it is cleared: a day-only plan leaves no time,
            // while its short-syntax action still carries the parser's time.
            taskFieldChanges[mapping.taskField] = currentTask
              ? currentTask[mapping.taskField as keyof Task]
              : changes[mapping.taskField];
          }
        }

        const parsed = parseInt(issueId, 10);
        const issueNumber = Number.isNaN(parsed) ? undefined : parsed;
        const ctx = { issueId, issueNumber };

        const decisions = computePushDecisions(
          taskFieldChanges,
          fieldMappings,
          issueSyncConfig,
          freshValues,
          // A task with no baseline at all was linked before two-way sync (e.g.
          // a migrated built-in provider, whose effects always pushed). If the
          // issue is unchanged since the task last saw it, its current values
          // are what the task last pulled, so the user's change can win; a
          // single missing field still means "first sync" and is skipped.
          syncState.issueLastSyncedValues ??
            (adapter.getIssueLastUpdated?.(freshIssue) === syncState.issueLastUpdated
              ? freshValues
              : {}),
          ctx,
        );

        const toPush: Record<string, unknown> = {};
        for (const d of decisions) {
          if (d.action === 'push') {
            toPush[d.field] = d.issueValue;
          }
        }

        const didPush = Object.keys(toPush).length > 0;
        if (!didPush) {
          return;
        }
        const writtenIssue = await adapter.pushChanges(issueId, toPush, cfg);

        const pushedDecisions = decisions.filter((d) => d.action === 'push');
        const pushedIssueFields = new Set(pushedDecisions.map((d) => d.field));
        const hasProviderOwnedSkip = decisions.some(
          (d) =>
            d.action === 'skip' &&
            (d.reasonCode === 'provider-changed' || d.reasonCode === 'no-baseline'),
        );

        // Detect remote changes in mapped fields we did NOT push this cycle — e.g.
        // the task was completed in Plainspace (isDone flipped) while the user was
        // pushing an unrelated rename/reschedule from SP. `freshIssue` was fetched
        // before our write, so `freshValues` still carries that un-pulled change.
        // Advancing issueLastUpdated past it would make the poll's "updatedAt
        // unchanged" guard treat it as already-seen and never pull it — silently
        // dropping the remote completion. Keep the old marker so the next poll
        // reconciles it. (hasProviderOwnedSkip already covers the changed fields.)
        const hasUnpulledRemoteChange = fieldMappings.some((m) => {
          if (pushedIssueFields.has(m.issueField)) {
            return false;
          }
          if (!(m.issueField in lastSyncedValues)) {
            return false;
          }
          return !issueValuesEqual(
            freshValues[m.issueField],
            lastSyncedValues[m.issueField],
          );
        });
        // A field the issue reports but the baseline lacks was never compared;
        // a stale marker lets the next poll seed the full baseline and pull it.
        // An undefined value (e.g. CalDAV `note`) has nothing to pull, and JSON
        // sync drops such keys from the baseline anyway.
        const hasUnseededField = fieldMappings.some(
          (m) =>
            freshValues[m.issueField] !== undefined &&
            !(m.issueField in lastSyncedValues),
        );
        const keepIssueLastUpdatedStale =
          hasProviderOwnedSkip || hasUnpulledRemoteChange || hasUnseededField;

        // Only advance baselines for fields we actually wrote. Fresh provider
        // values for skipped or unrelated fields still need the polling path to
        // pull them into the task before they become the new baseline.
        const updatedSyncValues: Record<string, unknown> = { ...lastSyncedValues };
        for (const pushDecision of pushedDecisions) {
          updatedSyncValues[pushDecision.field] = pushDecision.issueValue;
        }

        // After push, take the provider's updated marker (e.g. CalDAV etag
        // changes on write) from the write's own answer when the adapter returns
        // it, else re-fetch the issue. Fall back to Date.now() for providers
        // that don't implement getIssueLastUpdated.
        let issueLastUpdated = Date.now();
        if (!keepIssueLastUpdatedStale && adapter.getIssueLastUpdated) {
          const postPushIssue = writtenIssue || (await adapter.fetchIssue(issueId, cfg));
          issueLastUpdated = adapter.getIssueLastUpdated(postPushIssue);
        }

        // Update sync values and issueLastUpdated to prevent poll from
        // treating our own push as an external update. If any changed field was
        // provider-owned, or the remote has an un-pulled change in another mapped
        // field, keep the old issueLastUpdated so polling can pull it.
        //
        // One op with the pushed fields' own values, read at dispatch so an
        // edit made during the push is not overwritten: a field and its
        // baseline then win or lose together under field-level LWW (#11034).
        // An updateTaskUi, so no effect (this push, completion, time blocks)
        // and no task meta-reducer runs again for values that did not change.
        this._taskService.updateUi(task.id, {
          ...pushedValuesToCarry(
            this._taskEntities()[task.id],
            toPush,
            fieldMappings,
            ctx,
          ),
          issueLastSyncedValues: updatedSyncValues,
          ...(keepIssueLastUpdatedStale ? {} : { issueLastUpdated }),
        });
      }),
    );
  }

  /** Pushes the task's fields that differ from their baseline, if any. */
  private _pushPendingChanges$(task: Task): Observable<unknown> {
    const adapter = this._getAdapter(task.issueType!);
    if (!adapter) {
      return EMPTY;
    }
    return this._issueProviderService
      .getCfgOnce$(task.issueProviderId!, task.issueType as IssueProviderKey)
      .pipe(
        // The request was read when it arrived; an earlier push in the queue
        // may have moved the baseline since. Decide on the task as it is now,
        // or a field pushed meanwhile is sent again.
        concatMap((cfg) =>
          this._taskService.getByIdOnce$(task.id).pipe(
            concatMap((current) => {
              if (!current) {
                return EMPTY;
              }
              const pending = computePendingLocalChanges(
                current,
                adapter.getFieldMappings(),
                adapter.getSyncConfig(cfg),
                { issueId: current.issueId! },
              );
              return Object.keys(pending).length
                ? this._pushChanges$(current, pending)
                : EMPTY;
            }),
          ),
        ),
      );
  }

  private _toSyncFailure(err: unknown): IssueSyncFailure {
    return err instanceof IssueSyncPushError
      ? { msgKey: err.msgKey }
      : { text: getErrorTxt(err) };
  }

  private _trackSyncOriginatedTask(taskId: string): void {
    this._syncOriginatedTaskIds.add(taskId);
    if (
      this._syncOriginatedTaskIds.size > IssueTwoWaySyncEffects._MAX_SYNC_ORIGINATED_IDS
    ) {
      // Evict oldest entry (Set preserves insertion order) instead of clearing all
      const oldest = this._syncOriginatedTaskIds.values().next().value;
      if (oldest !== undefined) {
        this._syncOriginatedTaskIds.delete(oldest);
      }
    }
  }
}
