import { addSubTask } from '../tasks/store/task.actions';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { updateTimeSpentForTask } from '../tasks/store/task.reducer.util';
import { initialTaskState, taskReducer } from '../tasks/store/task.reducer';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { syncTimeSpent } from '../time-tracking/store/time-tracking.actions';

describe('Time session replay', () => {
  it('retains separate device recordings while adding their daily totals', () => {
    const task = {
      ...DEFAULT_TASK,
      id: 'task',
      projectId: 'INBOX',
      title: 'Task',
    } as Task;
    const initial = { ...initialTaskState, ids: ['task'], entities: { task } };
    const recordings = [
      { id: 'device-a', d: '2026-09-13', s: 1789286400000, t: 60000 },
      { id: 'device-b', d: '2026-09-13', s: 1789286520000, t: 120000 },
    ];
    const result = recordings.reduce(
      (state, session) => {
        const action = syncTimeSpent({
          taskId: 'task',
          date: session.d,
          duration: session.t,
        });
        return taskReducer(
          state,
          JSON.parse(
            JSON.stringify({
              ...action,
              session,
              meta: { ...action.meta, isRemote: true },
            }),
          ),
        );
      },
      initial as ReturnType<typeof taskReducer>,
    );
    expect(result.entities['task']!.timeSpentOnDay['2026-09-13']).toBe(180000);
    expect(
      (result.entities['task'] as unknown as { timeSessions?: unknown[] }).timeSessions,
    ).toEqual(recordings);
  });
  it('captures optional recording metadata for the operation journal', () => {
    const session = { id: 'session', d: '2026-09-13', s: 1789286400000, t: 60000 };
    const action = syncTimeSpent({
      taskId: 'task',
      date: session.d,
      duration: session.t,
      session,
    });
    expect(new OperationCaptureService().extractEntityChanges(action)[0].changes).toEqual(
      {
        taskId: 'task',
        date: session.d,
        duration: session.t,
        session,
      },
    );
  });
  it('keeps recordings intact when the authoritative day total is corrected', () => {
    const session = { id: 'session', d: '2026-09-13', s: 1789286400000, t: 60000 };
    const task = {
      ...DEFAULT_TASK,
      id: 'task',
      projectId: 'INBOX',
      timeSessions: [session],
      timeSpentOnDay: { [session.d]: 60000 },
    } as Task;
    const state = { ...initialTaskState, ids: ['task'], entities: { task } };
    const corrected = updateTimeSpentForTask('task', { [session.d]: 10000 }, state);
    expect(corrected.entities['task']!.timeSessions).toEqual([session]);
    expect(corrected.entities['task']!.timeSpentOnDay[session.d]).toBe(10000);
  });
  it('moves recordings with inherited time to the first subtask', () => {
    const session = { id: 'session', d: '2026-09-13', t: 60000 };
    const parent = {
      ...DEFAULT_TASK,
      id: 'parent',
      projectId: 'INBOX',
      timeSessions: [session],
      timeSpentOnDay: { [session.d]: session.t },
    } as Task;
    const child = { ...DEFAULT_TASK, id: 'child', projectId: 'INBOX' } as Task;
    const state = taskReducer(
      { ...initialTaskState, ids: ['parent'], entities: { parent } },
      addSubTask({ task: child, parentId: 'parent' }),
    );
    expect(state.entities['child']!.timeSessions).toEqual([session]);
    expect(state.entities['parent']!.timeSessions).toEqual([]);
    expect(state.entities['child']!.timeSpentOnDay[session.d]).toBe(60000);
  });
});
