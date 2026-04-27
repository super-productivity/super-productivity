import { Action, ActionReducer } from '@ngrx/store';
import { sectionSharedMetaReducer } from './section-shared.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { deleteTag, deleteTags } from '../../../features/tag/store/tag.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { SECTION_FEATURE_NAME } from '../../../features/section/store/section.reducer';
import { Section, SectionState } from '../../../features/section/section.model';
import { createBaseState, createMockTask } from './test-utils';
import { Task } from '../../../features/tasks/task.model';

const sectionStateOf = (sections: Section[]): SectionState => ({
  ids: sections.map((s) => s.id),
  entities: Object.fromEntries(sections.map((s) => [s.id, s])),
});

const stateWith = (
  tasks: Record<string, Partial<Task>>,
  sections: Section[],
): RootState & { [SECTION_FEATURE_NAME]: SectionState } => {
  const base = createBaseState();
  const taskIds = Object.keys(tasks);
  const taskEntities: Record<string, Task> = {};
  for (const id of taskIds) {
    taskEntities[id] = createMockTask({ id, ...tasks[id] });
  }
  return {
    ...base,
    [TASK_FEATURE_NAME]: {
      ...base[TASK_FEATURE_NAME],
      ids: taskIds,
      entities: taskEntities,
    },
    [SECTION_FEATURE_NAME]: sectionStateOf(sections),
  };
};

describe('sectionSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((s) => s);
    metaReducer = sectionSharedMetaReducer(mockReducer);
  });

  it('removes a deleted task id from any section that referenced it', () => {
    const state = stateWith({ t1: {}, t2: {} }, [
      {
        id: 's1',
        contextId: 'p1',
        contextType: 'PROJECT',
        title: 'A',
        taskIds: ['t1', 't2'],
      },
    ]);
    const action = TaskSharedActions.deleteTask({
      task: state[TASK_FEATURE_NAME].entities.t1 as Task,
    } as any);

    metaReducer(state, action);

    const updated = (mockReducer.calls.mostRecent().args[0] as any)[
      SECTION_FEATURE_NAME
    ] as SectionState;
    expect(updated.entities['s1']?.taskIds).toEqual(['t2']);
  });

  it('cascades subtask removal alongside the parent', () => {
    const state = stateWith(
      {
        parent: { subTaskIds: ['sub1', 'sub2'] },
        sub1: { parentId: 'parent' },
        sub2: { parentId: 'parent' },
        other: {},
      },
      [
        {
          id: 's1',
          contextId: 'p1',
          contextType: 'PROJECT',
          title: 'A',
          // sections only hold parent task ids in the new model, but the
          // meta-reducer must defensively scrub subtask ids too.
          taskIds: ['parent', 'other'],
        },
        {
          id: 's2',
          contextId: 'p1',
          contextType: 'PROJECT',
          title: 'B',
          taskIds: ['sub1'],
        },
      ],
    );

    metaReducer(
      state,
      TaskSharedActions.deleteTask({
        task: state[TASK_FEATURE_NAME].entities.parent as Task,
      } as any),
    );

    const updated = (mockReducer.calls.mostRecent().args[0] as any)[
      SECTION_FEATURE_NAME
    ] as SectionState;
    expect(updated.entities['s1']?.taskIds).toEqual(['other']);
    expect(updated.entities['s2']?.taskIds).toEqual([]);
  });

  it('handles deleteTasks (bulk) across multiple sections', () => {
    const state = stateWith({ t1: {}, t2: {}, t3: {}, t4: {} }, [
      {
        id: 's1',
        contextId: 'p1',
        contextType: 'PROJECT',
        title: 'A',
        taskIds: ['t1', 't2'],
      },
      {
        id: 's2',
        contextId: 'p1',
        contextType: 'PROJECT',
        title: 'B',
        taskIds: ['t3', 't4'],
      },
    ]);

    metaReducer(state, TaskSharedActions.deleteTasks({ taskIds: ['t1', 't3'] }));

    const updated = (mockReducer.calls.mostRecent().args[0] as any)[
      SECTION_FEATURE_NAME
    ] as SectionState;
    expect(updated.entities['s1']?.taskIds).toEqual(['t2']);
    expect(updated.entities['s2']?.taskIds).toEqual(['t4']);
  });

  it('passes through unrelated actions unchanged', () => {
    const state = stateWith({ t1: {} }, [
      {
        id: 's1',
        contextId: 'p1',
        contextType: 'PROJECT',
        title: 'A',
        taskIds: ['t1'],
      },
    ]);

    metaReducer(state, { type: '[Other] noop' } as Action);
    expect(mockReducer.calls.mostRecent().args[0]).toBe(state);
  });

  it('is a no-op when no section references the deleted task', () => {
    const state = stateWith({ t1: {}, t2: {} }, [
      {
        id: 's1',
        contextId: 'p1',
        contextType: 'PROJECT',
        title: 'A',
        taskIds: ['t2'],
      },
    ]);

    metaReducer(
      state,
      TaskSharedActions.deleteTask({
        task: state[TASK_FEATURE_NAME].entities.t1 as Task,
      } as any),
    );

    expect(mockReducer.calls.mostRecent().args[0]).toBe(state);
  });

  describe('context deletion', () => {
    it('removes sections owned by a deleted project but leaves other contexts alone', () => {
      const state = stateWith({}, [
        {
          id: 'sP',
          contextId: 'p1',
          contextType: 'PROJECT',
          title: 'In project',
          taskIds: [],
        },
        {
          id: 'sP2',
          contextId: 'p2',
          contextType: 'PROJECT',
          title: 'Other project',
          taskIds: [],
        },
        {
          id: 'sT',
          contextId: 'p1',
          contextType: 'TAG',
          title: 'Tag with same id (no collision)',
          taskIds: [],
        },
      ]);

      metaReducer(
        state,
        TaskSharedActions.deleteProject({
          projectId: 'p1',
          allTaskIds: [],
          noteIds: [],
        } as any),
      );

      const updated = (mockReducer.calls.mostRecent().args[0] as any)[
        SECTION_FEATURE_NAME
      ] as SectionState;
      expect(updated.entities['sP']).toBeUndefined();
      expect(updated.entities['sP2']).toBeDefined();
      // contextType='TAG' with the same id is intentionally not touched.
      expect(updated.entities['sT']).toBeDefined();
    });

    it('removes a tag context section on deleteTag', () => {
      const state = stateWith({}, [
        {
          id: 'sT',
          contextId: 'tag1',
          contextType: 'TAG',
          title: 'Tag section',
          taskIds: [],
        },
        {
          id: 'sP',
          contextId: 'tag1',
          contextType: 'PROJECT',
          title: 'Project with same id',
          taskIds: [],
        },
      ]);

      metaReducer(state, deleteTag({ id: 'tag1' } as any));

      const updated = (mockReducer.calls.mostRecent().args[0] as any)[
        SECTION_FEATURE_NAME
      ] as SectionState;
      expect(updated.entities['sT']).toBeUndefined();
      expect(updated.entities['sP']).toBeDefined();
    });

    it('removes tag-context sections in bulk on deleteTags', () => {
      const state = stateWith({}, [
        {
          id: 's1',
          contextId: 'a',
          contextType: 'TAG',
          title: 'a',
          taskIds: [],
        },
        {
          id: 's2',
          contextId: 'b',
          contextType: 'TAG',
          title: 'b',
          taskIds: [],
        },
        {
          id: 's3',
          contextId: 'c',
          contextType: 'TAG',
          title: 'c',
          taskIds: [],
        },
      ]);

      metaReducer(state, deleteTags({ ids: ['a', 'c'] } as any));

      const updated = (mockReducer.calls.mostRecent().args[0] as any)[
        SECTION_FEATURE_NAME
      ] as SectionState;
      expect(updated.entities['s1']).toBeUndefined();
      expect(updated.entities['s2']).toBeDefined();
      expect(updated.entities['s3']).toBeUndefined();
    });
  });
});
