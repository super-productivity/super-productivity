import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { filter, first, switchMap, tap } from 'rxjs/operators';
import { selectAllTasks } from '../../features/tasks/store/task.selectors';
import { TaskService } from '../../features/tasks/task.service';
import { T } from '../../t.const';
import { LS } from '../persistence/storage-keys.const';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';

interface ExampleTaskDef {
  titleKey: string;
  notesKey: string;
}

const EXAMPLE_TASK_DEFS: ExampleTaskDef[] = [
  {
    titleKey: T.EXAMPLE_TASKS.CREATE_PROJECT.TITLE,
    notesKey: T.EXAMPLE_TASKS.CREATE_PROJECT.NOTES,
  },
  {
    titleKey: T.EXAMPLE_TASKS.SET_UP_SYNC.TITLE,
    notesKey: T.EXAMPLE_TASKS.SET_UP_SYNC.NOTES,
  },
  {
    titleKey: T.EXAMPLE_TASKS.LEARN_KEYBOARD_SHORTCUTS.TITLE,
    notesKey: T.EXAMPLE_TASKS.LEARN_KEYBOARD_SHORTCUTS.NOTES,
  },
  {
    titleKey: T.EXAMPLE_TASKS.GO_FURTHER.TITLE,
    notesKey: T.EXAMPLE_TASKS.GO_FURTHER.NOTES,
  },
];

const TASK_CONTEXT = {
  workContextId: INBOX_PROJECT.id,
  workContextType: WorkContextType.PROJECT,
  isAddToBacklog: false,
  isAddToBottom: true,
} as const;

@Injectable({ providedIn: 'root' })
export class ExampleTasksService {
  private _store = inject(Store);
  private _syncTriggerService = inject(SyncTriggerService);
  private _translateService = inject(TranslateService);
  private _taskService = inject(TaskService);

  constructor() {
    if (localStorage.getItem(LS.EXAMPLE_TASKS_CREATED)) {
      return;
    }

    // Wait for the STRICT initial-sync signal. For SuperSync the non-strict signal
    // resolves immediately (before the first download completes), so example tasks
    // would be created before an incoming SYNC_IMPORT lands and then collide with it.
    // Waiting for the actual initial sync means any imported tasks are already in the
    // store, so the `length === 0` guard below short-circuits and no example tasks are
    // created on a fresh synced client (this also covers file-based providers, which
    // the op-log conflict gate cannot). The `isExampleTask` marker on the dispatched
    // action below stays as a safety net for the narrow case where example tasks are
    // created on a still-empty server and an import arrives before they are uploaded.
    this._syncTriggerService.afterInitialSyncDoneStrict$
      .pipe(
        first(),
        switchMap(() => this._store.select(selectAllTasks).pipe(first())),
        // Tasks already exist (e.g. synced from another device): mark onboarding done
        // so a future empty-task startup does not recreate example tasks. (#7976)
        tap((tasks) => {
          if (tasks.length > 0) {
            localStorage.setItem(LS.EXAMPLE_TASKS_CREATED, 'true');
          }
        }),
        filter((tasks) => tasks.length === 0),
        switchMap(() => {
          const keys = EXAMPLE_TASK_DEFS.flatMap((def) => [def.titleKey, def.notesKey]);
          return this._translateService.get(keys);
        }),
      )
      .subscribe((translations) => {
        // Guard: don't create tasks with raw translation keys
        if (
          translations[EXAMPLE_TASK_DEFS[0].titleKey] === EXAMPLE_TASK_DEFS[0].titleKey
        ) {
          return;
        }
        for (const def of EXAMPLE_TASK_DEFS) {
          const task = this._taskService.createNewTaskWithDefaults({
            title: translations[def.titleKey],
            additional: { notes: translations[def.notesKey] },
            ...TASK_CONTEXT,
          });
          this._store.dispatch(
            TaskSharedActions.addTask({
              task,
              ...TASK_CONTEXT,
              isExampleTask: true,
            }),
          );
        }
        localStorage.setItem(LS.EXAMPLE_TASKS_CREATED, 'true');
      });
  }
}
