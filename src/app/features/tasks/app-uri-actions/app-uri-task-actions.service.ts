import { Injectable, OnDestroy, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription, merge } from 'rxjs';
import { concatMap, map, take } from 'rxjs/operators';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import {
  ipcAddTaskFromAppUri$,
  ipcCompleteTaskFromAppUri$,
} from '../../../core/ipc-events';
import { TaskService } from '../task.service';
import { ProjectService } from '../../project/project.service';
import { selectAllTasksInActiveProjects } from '../store/task.selectors';
import {
  AppUriAddTaskAction,
  AppUriCompleteTaskAction,
  AppUriTaskAction,
} from '../util/parse-app-uri-task-action';
import { PENDING_CAPACITOR_APP_URI_ACTION } from './pending-capacitor-app-uri-action';

// Reject an over-long title/notes coming from an external URL trigger — a title
// syncs as an op to every device, so an unbounded one is an abuse/accident
// footgun. Caps match the EML import path's limits (title 300, body 100k); unlike
// EML (a drag-dropped file, silently truncated) a URL is a single deliberate call,
// so we reject with feedback rather than truncate.
const MAX_APP_URI_TITLE_LENGTH = 300;
const MAX_APP_URI_NOTES_LENGTH = 100_000;

/**
 * Handles `create-task`/`complete-task` actions coming from an external URL
 * scheme trigger (an iOS Shortcut's "Open URLs" action, or the equivalent
 * `superproductivity://` desktop protocol action) — one code path for both
 * Electron (via IPC) and Capacitor/iOS (via the pending-action ReplaySubject
 * populated in `main.ts`, since a cold launch happens before Angular's DI or
 * this service exist).
 *
 * Actions are buffered until `isAllDataLoadedInitially$` fires, so a
 * cold-launched add/complete never races the app's own data hydration.
 */
@Injectable({ providedIn: 'root' })
export class AppUriTaskActionsService implements OnDestroy {
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _snackService = inject(SnackService);
  private _dataInitStateService = inject(DataInitStateService);
  private _pendingCapacitorAction$ = inject(PENDING_CAPACITOR_APP_URI_ACTION);

  private _subs = new Subscription();

  constructor() {
    const electronActions$ = merge(
      ipcAddTaskFromAppUri$.pipe(
        map((payload): AppUriAddTaskAction => ({ type: 'add', ...payload })),
      ),
      ipcCompleteTaskFromAppUri$.pipe(
        map((payload): AppUriCompleteTaskAction => ({ type: 'complete', ...payload })),
      ),
    );

    this._subs.add(
      merge(electronActions$, this._pendingCapacitorAction$)
        .pipe(
          // Wait for initial data load so an action from a cold launch never
          // races app hydration (e.g. dispatching against an empty pre-hydration
          // store, or an as-yet-unloaded project list for `projectId` validation).
          concatMap((action) =>
            this._dataInitStateService.isAllDataLoadedInitially$.pipe(map(() => action)),
          ),
        )
        .subscribe((action) => this._handleAction(action)),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  private _handleAction(action: AppUriTaskAction): void {
    if (action.type === 'add') {
      this._handleAdd(action);
    } else {
      this._handleComplete(action);
    }
  }

  private _handleAdd(action: AppUriAddTaskAction): void {
    if (
      action.title.length > MAX_APP_URI_TITLE_LENGTH ||
      (action.notes?.length ?? 0) > MAX_APP_URI_NOTES_LENGTH
    ) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.TASK.S.INPUT_TOO_LONG_VIA_APP_URI,
      });
      return;
    }

    const title = action.title.trim();
    if (!title) {
      // A whitespace-only title (e.g. `?title=%20`) reaches here unrejected on
      // the Electron path, since the protocol handler's `if (taskTitle)` check
      // treats a space as truthy. Refuse rather than creating a blank task.
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.TASK.S.EMPTY_TITLE_VIA_APP_URI,
      });
      return;
    }

    if (action.projectId) {
      const projectExists = this._projectService
        .list()
        .some((project) => project.id === action.projectId);
      // An unresolvable projectId fails the whole action rather than
      // silently dropping it and adding the task anyway — the caller
      // otherwise gets a SUCCESS snack with no signal that its projectId
      // was ignored. Mirrors PluginBridgeService's addTask, which
      // validates references and rejects rather than degrading silently.
      if (!projectExists) {
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.TASK.S.PROJECT_NOT_FOUND_VIA_APP_URI,
          translateParams: { title },
        });
        return;
      }
    }

    // isIgnoreShortSyntax: a URL is untrusted external content, so the title is
    // added verbatim rather than parsed for `+project`/`#tag`/`@date` tokens
    // (mirrors eml-drop.service.ts). This keeps an explicit `projectId`
    // authoritative — a `+project` in the title can't silently override the
    // validated one — stops a URL from creating tags/projects, and keeps the
    // SUCCESS snack's title matching what is actually stored.
    this._taskService.add(
      title,
      false,
      {
        ...(action.notes ? { notes: action.notes } : {}),
        ...(action.projectId ? { projectId: action.projectId } : {}),
      },
      false,
      true,
    );

    this._snackService.open({
      type: 'SUCCESS',
      msg: T.F.TASK.S.ADDED_VIA_APP_URI,
      translateParams: { title },
    });
  }

  private _handleComplete(action: AppUriCompleteTaskAction): void {
    if (action.title.length > MAX_APP_URI_TITLE_LENGTH) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.TASK.S.INPUT_TOO_LONG_VIA_APP_URI,
      });
      return;
    }

    const needle = action.title.trim().toLowerCase();
    if (!needle) {
      // A whitespace-only title would otherwise match every task via
      // `.includes('')` — refuse rather than completing an arbitrary one.
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
        translateParams: { title: action.title },
      });
      return;
    }
    this._subs.add(
      this._store
        .select(selectAllTasksInActiveProjects)
        .pipe(take(1))
        .subscribe((tasks) => {
          // Subtasks are excluded: completing "standup" shouldn't complete a
          // subtask of an unrelated parent task that happens to share the word.
          const candidates = tasks.filter(
            (task) =>
              !task.isDone && !task.parentId && task.title.toLowerCase().includes(needle),
          );
          // An exact match is unambiguous even when a substring match isn't
          // (e.g. "standup" should complete the task titled exactly that, not
          // guess between it and "standup notes").
          const exact = candidates.filter((task) => task.title.toLowerCase() === needle);
          const matches = exact.length > 0 ? exact : candidates;

          if (matches.length === 0) {
            this._snackService.open({
              type: 'ERROR',
              msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
              translateParams: { title: action.title },
            });
            return;
          }
          if (matches.length > 1) {
            // Several equally-plausible non-exact matches — error rather than
            // guessing and silently completing the wrong one.
            this._snackService.open({
              type: 'ERROR',
              msg: T.F.TASK.S.AMBIGUOUS_MATCH_VIA_APP_URI,
              translateParams: { title: action.title },
            });
            return;
          }
          const match = matches[0];
          this._taskService.setDone(match.id);
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.TASK.S.COMPLETED_VIA_APP_URI,
            translateParams: { title: match.title },
          });
        }),
    );
  }
}
