import { createTask } from '../task.test-helper';
import { TaskWithSubTasks } from '../task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PLAINSPACE_TYPE } from '../../issue/issue.const';
import { INBOX_PROJECT } from '../../project/project.const';
import {
  getRecentlyDeletedChanges,
  getRecentlyDeletedEntriesFromAction,
  getRestoredTaskIdsFromAction,
  getRestoreTaskPayload,
  isRecentlyDeletedEntryExpired,
  RECENTLY_DELETED_RETENTION_MS,
} from './recently-deleted.util';
import { taskSharedLifecycleMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-lifecycle.reducer';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { TASK_FEATURE_NAME } from '../store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../project/store/project.reducer';
import { RootState } from '../../../root-store/root-state';

const DELETED_AT = 1_700_000_000_000;

describe('recently-deleted.util', () => {
  describe('getRecentlyDeletedEntriesFromAction – deleteTask', () => {
    it('stores the root without its subTasks array, plus the subtasks', () => {
      const sub = createTask({ id: 'sub', title: 'Sub', parentId: 'root' });
      const root: TaskWithSubTasks = {
        ...createTask({ id: 'root', title: 'Root', subTaskIds: ['sub'] }),
        subTasks: [sub],
      };

      const entries = getRecentlyDeletedEntriesFromAction(
        TaskSharedActions.deleteTask({ task: root }),
        DELETED_AT,
      );

      expect(entries.length).toBe(1);
      expect(entries[0].id).toBe('root');
      expect(entries[0].deletedAt).toBe(DELETED_AT);
      expect(entries[0].subTasks).toEqual([sub]);
      expect('subTasks' in entries[0].task).toBeFalse();
    });

    it('accepts a raw subtask without a subTasks array (#9280 keyboard path)', () => {
      const sub = createTask({ id: 'sub', title: 'Sub', parentId: 'root' });

      const entries = getRecentlyDeletedEntriesFromAction(
        TaskSharedActions.deleteTask({ task: sub as TaskWithSubTasks }),
        DELETED_AT,
      );

      expect(entries.map((e) => e.id)).toEqual(['sub']);
      expect(entries[0].subTasks).toEqual([]);
    });

    it('skips Plainspace tasks', () => {
      const task = {
        ...createTask({ id: 'p', title: 'Shared', issueType: PLAINSPACE_TYPE }),
        subTasks: [],
      } as TaskWithSubTasks;

      expect(
        getRecentlyDeletedEntriesFromAction(
          TaskSharedActions.deleteTask({ task }),
          DELETED_AT,
        ),
      ).toEqual([]);
    });

    it('skips blank tasks (they get no undo snack either)', () => {
      const task = { ...createTask({ id: 'b', title: '  ' }), subTasks: [] };

      expect(
        getRecentlyDeletedEntriesFromAction(
          TaskSharedActions.deleteTask({ task }),
          DELETED_AT,
        ),
      ).toEqual([]);
    });

    it('ignores a malformed remote payload', () => {
      expect(
        getRecentlyDeletedEntriesFromAction(
          { type: TaskSharedActions.deleteTask.type, task: null } as never,
          DELETED_AT,
        ),
      ).toEqual([]);
    });
  });

  describe('getRecentlyDeletedEntriesFromAction – deleteTasks', () => {
    it('creates one entry per root and groups cascaded subtasks under it', () => {
      const a = createTask({ id: 'a', title: 'A', subTaskIds: ['a1'] });
      const a1 = createTask({ id: 'a1', title: 'A1', parentId: 'a' });
      const b = createTask({ id: 'b', title: 'B' });

      const entries = getRecentlyDeletedEntriesFromAction(
        TaskSharedActions.deleteTasks({ taskIds: ['a', 'b'], tasks: [a, a1, b] }),
        DELETED_AT,
      );

      expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
      expect(entries[0].subTasks.map((t) => t.id)).toEqual(['a1']);
      expect(entries[1].subTasks).toEqual([]);
    });

    it('does not create a separate entry for a subtask listed with its parent', () => {
      const a = createTask({ id: 'a', title: 'A', subTaskIds: ['a1'] });
      const a1 = createTask({ id: 'a1', title: 'A1', parentId: 'a' });

      const entries = getRecentlyDeletedEntriesFromAction(
        TaskSharedActions.deleteTasks({ taskIds: ['a', 'a1'], tasks: [a, a1] }),
        DELETED_AT,
      );

      expect(entries.map((e) => e.id)).toEqual(['a']);
    });

    it('gives a lone deleted subtask its own entry when its parent survives', () => {
      const a1 = createTask({ id: 'a1', title: 'A1', parentId: 'a' });

      const entries = getRecentlyDeletedEntriesFromAction(
        TaskSharedActions.deleteTasks({ taskIds: ['a1'], tasks: [a1] }),
        DELETED_AT,
      );

      expect(entries.map((e) => e.id)).toEqual(['a1']);
    });

    it('records nothing for a bulk delete without snapshots', () => {
      expect(
        getRecentlyDeletedEntriesFromAction(
          TaskSharedActions.deleteTasks({ taskIds: ['a'] }),
          DELETED_AT,
        ),
      ).toEqual([]);
    });
  });

  it('getRestoredTaskIdsFromAction returns the restored root id', () => {
    const task = createTask({ id: 'r', title: 'R' });
    expect(
      getRestoredTaskIdsFromAction(TaskSharedActions.restoreTask({ task, subTasks: [] })),
    ).toEqual(['r']);
    expect(
      getRestoredTaskIdsFromAction(
        TaskSharedActions.restoreDeletedTask({
          task: { ...task, subTasks: [] },
          tagTaskIdMap: {},
          deletedTaskEntities: {},
        }),
      ),
    ).toEqual(['r']);
    expect(
      getRestoredTaskIdsFromAction(
        TaskSharedActions.deleteTask({ task: { ...task, subTasks: [] } }),
      ),
    ).toEqual([]);
  });

  it('isRecentlyDeletedEntryExpired uses the fixed 30-day retention', () => {
    expect(RECENTLY_DELETED_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const entry = { deletedAt: DELETED_AT };
    expect(
      isRecentlyDeletedEntryExpired(entry, DELETED_AT + RECENTLY_DELETED_RETENTION_MS),
    ).toBeFalse();
    expect(
      isRecentlyDeletedEntryExpired(
        entry,
        DELETED_AT + RECENTLY_DELETED_RETENTION_MS + 1,
      ),
    ).toBeTrue();
  });

  describe('getRestoreTaskPayload', () => {
    it('restores a deleted subtask as a top-level task in its project', () => {
      const sub = createTask({
        id: 'sub',
        title: 'Sub',
        parentId: 'gone',
        projectId: 'p1',
      });

      const { task, subTasks } = getRestoreTaskPayload({
        id: 'sub',
        deletedAt: DELETED_AT,
        task: sub,
        subTasks: [],
      });

      expect(task.parentId).toBeUndefined();
      expect(task.projectId).toBe('p1');
      expect(subTasks).toEqual([]);
    });

    it('lands a restored subtask as a top-level project task through the real reducer', () => {
      const reducer = jasmine
        .createSpy('reducer')
        .and.callFake((state: RootState) => state);
      const metaReducer = taskSharedLifecycleMetaReducer(reducer);
      const sub = createMockTask({ id: 'sub', parentId: 'gone', projectId: 'project1' });

      const next = metaReducer(
        createBaseState(),
        TaskSharedActions.restoreTask(
          getRestoreTaskPayload({
            id: 'sub',
            deletedAt: DELETED_AT,
            task: sub,
            subTasks: [],
          }),
        ),
      ) as RootState;

      expect(next[TASK_FEATURE_NAME].entities['sub']?.parentId).toBeUndefined();
      expect(next[PROJECT_FEATURE_NAME].entities['project1']?.taskIds).toEqual(['sub']);
    });

    it('moves a task whose project is no longer active to the Inbox', () => {
      const t = createTask({ id: 't', title: 'T', projectId: 'archived' });

      expect(
        getRestoreTaskPayload(
          { id: 't', deletedAt: DELETED_AT, task: t, subTasks: [] },
          (id) => id !== 'archived',
        ).task.projectId,
      ).toBe(INBOX_PROJECT.id);
    });

    it('falls back to the Inbox when the snapshot has no project', () => {
      const t = createTask({ id: 't', title: 'T', projectId: '' });

      expect(
        getRestoreTaskPayload({ id: 't', deletedAt: DELETED_AT, task: t, subTasks: [] })
          .task.projectId,
      ).toBe(INBOX_PROJECT.id);
    });
  });

  describe('getRecentlyDeletedChanges', () => {
    const del = (id: string): ReturnType<typeof TaskSharedActions.deleteTask> =>
      TaskSharedActions.deleteTask({
        task: { ...createTask({ id, title: id }), subTasks: [] },
      });
    const restore = (id: string): ReturnType<typeof TaskSharedActions.restoreTask> =>
      TaskSharedActions.restoreTask({ task: createTask({ id }), subTasks: [] });

    it('folds a batch in order: the last action per task wins', () => {
      const { puts, deleteIds } = getRecentlyDeletedChanges(
        [
          { action: del('a'), deletedAt: DELETED_AT },
          { action: restore('a'), deletedAt: DELETED_AT },
          { action: restore('b'), deletedAt: DELETED_AT },
          { action: del('b'), deletedAt: DELETED_AT },
        ],
        DELETED_AT,
      );

      expect(puts.map((e) => e.id)).toEqual(['b']);
      expect(deleteIds).toEqual(['a']);
    });

    it('skips deletes already past the retention', () => {
      const { puts } = getRecentlyDeletedChanges(
        [{ action: del('a'), deletedAt: DELETED_AT }],
        DELETED_AT + RECENTLY_DELETED_RETENTION_MS + 1,
      );
      expect(puts).toEqual([]);
    });
  });
});
