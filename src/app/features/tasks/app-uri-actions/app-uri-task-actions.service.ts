import { Injectable, OnDestroy, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription, merge } from 'rxjs';
import { concatMap, map, take } from 'rxjs/operators';
import { Log } from '../../../core/log';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import {
  ipcAddTaskFromAppUri$,
  ipcCompleteTaskFromAppUri$,
} from '../../../core/ipc-events';
import { TaskService } from '../task.service';
import { ProjectService } from '../../project/project.service';
import { selectAllTasks } from '../store/task.selectors';
import {
  AppUriAddTaskAction,
  AppUriCompleteTaskAction,
  AppUriTaskAction,
} from '../util/parse-app-uri-task-action';
import { PENDING_CAPACITOR_APP_URI_ACTION } from './pending-capacitor-app-uri-action';

/**
 * Handles `add-task`/`complete-task` actions coming from an external URL
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
    let projectId: string | undefined;
    if (action.projectId) {
      const projectExists = this._projectService
        .list()
        .some((project) => project.id === action.projectId);
      if (projectExists) {
        projectId = action.projectId;
      } else {
        Log.log(
          'AppUriTaskActionsService: unknown projectId in add-task action, ignoring it',
        );
      }
    }

    this._taskService.add(action.title, false, {
      ...(action.notes ? { notes: action.notes } : {}),
      ...(projectId ? { projectId } : {}),
    });

    this._snackService.open({
      type: 'SUCCESS',
      msg: T.F.TASK.S.ADDED_VIA_APP_URI,
      translateParams: { title: action.title },
    });
  }

  private _handleComplete(action: AppUriCompleteTaskAction): void {
    const needle = action.title.trim().toLowerCase();
    this._subs.add(
      this._store
        .select(selectAllTasks)
        .pipe(take(1))
        .subscribe((tasks) => {
          const match = tasks.find(
            (task) => !task.isDone && task.title.toLowerCase().includes(needle),
          );
          if (!match) {
            this._snackService.open({
              type: 'ERROR',
              msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
              translateParams: { title: action.title },
            });
            return;
          }
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
