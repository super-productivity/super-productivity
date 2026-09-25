/**
 * Regression for the "one client keeps showing remotely-archived tasks as
 * active after a long idle" report.
 *
 * Sequence under test (real reducer + real store, no mocked seam):
 *   1. a remote `moveToArchive` removes the task the idle dialog captured
 *      before it opened (`openIdleDialog.lastCurrentTaskId`, idle.effects.ts)
 *   2. the idle flow untracks the idle time (`removeTimeSpent`) and the dialog
 *      result dispatches `setCurrentTask({ id: <that stale id> })`
 *      (idle.effects.ts via TaskService.setCurrentId)
 *
 * Both reducers used to call `getTaskById()`, which throws for a missing
 * entity. There is no boxing meta-reducer for these actions, so the throw
 * escaped the NgRx `State` scan and tore the state subscription down: every
 * later dispatch — including the bulk apply of the next remote
 * `moveToArchive` — was silently dropped from NgRx state while the op log
 * still marked those ops applied.
 */
import { TestBed } from '@angular/core/testing';
import { Store, StoreModule } from '@ngrx/store';
import {
  TASK_FEATURE_NAME,
  initialTaskState,
  taskReducer,
} from '../../tasks/store/task.reducer';
import { TaskState, TaskWithSubTasks } from '../../tasks/task.model';
import { createTask } from '../../tasks/task.test-helper';
import { removeTimeSpent, setCurrentTask } from '../../tasks/store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

const IDLE_TASK = createTask({ id: 'IDLE_TRACKED', title: 'tracked when idle started' });
const OTHER_TASK = createTask({ id: 'OTHER', title: 'archived by the next remote op' });

const seedState: TaskState = {
  ...initialTaskState,
  ids: [IDLE_TASK.id, OTHER_TASK.id],
  entities: { [IDLE_TASK.id]: IDLE_TASK, [OTHER_TASK.id]: OTHER_TASK },
  currentTaskId: IDLE_TASK.id,
};

const asArchivable = (t: typeof IDLE_TASK): TaskWithSubTasks =>
  ({ ...t, subTasks: [] }) as TaskWithSubTasks;

describe('idle dialog result on a remotely archived task', () => {
  let store: Store<{ [TASK_FEATURE_NAME]: TaskState }>;

  const taskState = (): TaskState => {
    let s: TaskState | undefined;
    store
      .select((rootState) => (rootState as Record<string, TaskState>)[TASK_FEATURE_NAME])
      .subscribe((v) => (s = v))
      .unsubscribe();
    return s as TaskState;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        StoreModule.forRoot(
          { [TASK_FEATURE_NAME]: taskReducer },
          { initialState: { [TASK_FEATURE_NAME]: seedState } },
        ),
      ],
    });
    store = TestBed.inject(Store);
  });

  it('keeps the store alive, so the NEXT remote moveToArchive reaches state', () => {
    // 1. remote archive #1 lands while the idle dialog is open
    store.dispatch(TaskSharedActions.moveToArchive({ tasks: [asArchivable(IDLE_TASK)] }));
    expect(taskState().entities[IDLE_TASK.id]).toBeUndefined();

    // 2. the idle flow untracks idle time and "[Idle] Dialog result" sets the
    //    stale id as current again
    store.dispatch(
      removeTimeSpent({ id: IDLE_TASK.id, date: '2026-01-01', duration: 1000 }),
    );
    store.dispatch(setCurrentTask({ id: IDLE_TASK.id }));
    expect(taskState().currentTaskId).toBeNull();

    // 3. the next remote moveToArchive must still reach NgRx state
    store.dispatch(
      TaskSharedActions.moveToArchive({ tasks: [asArchivable(OTHER_TASK)] }),
    );
    expect(taskState().entities[OTHER_TASK.id])
      .withContext('store is dead — remote archive never reached NgRx state')
      .toBeUndefined();
  });
});
