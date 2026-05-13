import { Action, ActionReducer } from '@ngrx/store';
import { sectionSharedMetaReducer } from './section-shared.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { removeTaskFromSection } from '../../../features/section/store/section.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { SECTION_FEATURE_NAME } from '../../../features/section/store/section.reducer';
import { Section, SectionState } from '../../../features/section/section.model';
import { createBaseState, createMockTask } from './test-utils';
import { Task } from '../../../features/tasks/task.model';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';

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
        contextType: WorkContextType.PROJECT,
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
          contextType: WorkContextType.PROJECT,
          title: 'A',
          // sections only hold parent task ids in the new model, but the
          // meta-reducer must defensively scrub subtask ids too.
          taskIds: ['parent', 'other'],
        },
        {
          id: 's2',
          contextId: 'p1',
          contextType: WorkContextType.PROJECT,
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

  it('removes a task from sections when converting it to a subtask', () => {
    const state = stateWith({ t1: {}, parent: {} }, [
      {
        id: 's1',
        contextId: 'p1',
        contextType: WorkContextType.PROJECT,
        title: 'A',
        taskIds: ['t1', 'parent'],
      },
    ]);

    metaReducer(
      state,
      TaskSharedActions.convertToSubTask({
        taskId: 't1',
        targetTaskId: 'parent',
        afterTaskId: null,
      }),
    );

    const updated = (mockReducer.calls.mostRecent().args[0] as any)[
      SECTION_FEATURE_NAME
    ] as SectionState;
    expect(updated.entities['s1']?.taskIds).toEqual(['parent']);
  });

  it('strips archived tasks (and their subtasks) from sections on moveToArchive', () => {
    const state = stateWith(
      {
        parent: { subTaskIds: ['sub1'] },
        sub1: { parentId: 'parent' },
        other: {},
      },
      [
        {
          id: 's1',
          contextId: 'p1',
          contextType: WorkContextType.PROJECT,
          title: 'A',
          taskIds: ['parent', 'other'],
        },
        {
          id: 's2',
          contextId: 'p1',
          contextType: WorkContextType.PROJECT,
          title: 'B',
          taskIds: ['sub1'],
        },
      ],
    );

    metaReducer(
      state,
      TaskSharedActions.moveToArchive({
        tasks: [{ ...state[TASK_FEATURE_NAME].entities.parent, subTasks: [] } as any],
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
        contextType: WorkContextType.PROJECT,
        title: 'A',
        taskIds: ['t1', 't2'],
      },
      {
        id: 's2',
        contextId: 'p1',
        contextType: WorkContextType.PROJECT,
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
        contextType: WorkContextType.PROJECT,
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
        contextType: WorkContextType.PROJECT,
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
          contextType: WorkContextType.PROJECT,
          title: 'In project',
          taskIds: [],
        },
        {
          id: 'sP2',
          contextId: 'p2',
          contextType: WorkContextType.PROJECT,
          title: 'Other project',
          taskIds: [],
        },
        {
          id: 'sT',
          contextId: 'p1',
          contextType: WorkContextType.TAG,
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

    it('on deleteProject, also strips cascaded task ids from tag-context sections', () => {
      // task t1 lives in project p1 AND in tag tA. Deleting p1 removes t1
      // (task.reducer cascades removeMany(allTaskIds)); the tag-context
      // section sA must drop t1 from its taskIds in the same reducer pass.
      const state = stateWith(
        {
          t1: { projectId: 'p1', tagIds: ['tA'] },
          t2: { projectId: 'p1' },
        },
        [
          {
            id: 'sP',
            contextId: 'p1',
            contextType: WorkContextType.PROJECT,
            title: 'Project section',
            taskIds: ['t1', 't2'],
          },
          {
            id: 'sA',
            contextId: 'tA',
            contextType: WorkContextType.TAG,
            title: 'Tag section',
            taskIds: ['t1'],
          },
        ],
      );

      metaReducer(
        state,
        TaskSharedActions.deleteProject({
          projectId: 'p1',
          allTaskIds: ['t1', 't2'],
          noteIds: [],
        } as any),
      );

      const updated = (mockReducer.calls.mostRecent().args[0] as any)[
        SECTION_FEATURE_NAME
      ] as SectionState;
      expect(updated.entities['sP']).toBeUndefined();
      expect(updated.entities['sA']).toBeDefined();
      expect(updated.entities['sA']?.taskIds).toEqual([]);
    });

    it('strips a moved task (and its subtasks) from sections in the old project only', () => {
      const state = stateWith(
        {
          parent: { projectId: 'oldP', subTaskIds: ['sub1'] },
          sub1: { projectId: 'oldP', parentId: 'parent' },
        },
        [
          {
            id: 'sOld',
            contextId: 'oldP',
            contextType: WorkContextType.PROJECT,
            title: 'old project section',
            taskIds: ['parent', 'sub1', 'unrelated'],
          },
          {
            id: 'sOther',
            contextId: 'newP',
            contextType: WorkContextType.PROJECT,
            title: 'target project section',
            taskIds: [],
          },
          {
            id: 'sTag',
            contextId: 'oldP',
            contextType: WorkContextType.TAG,
            title: 'tag with same id as old project',
            taskIds: ['parent'],
          },
        ],
      );

      metaReducer(
        state,
        TaskSharedActions.moveToOtherProject({
          task: state[TASK_FEATURE_NAME].entities.parent as any,
          targetProjectId: 'newP',
        } as any),
      );

      const updated = (mockReducer.calls.mostRecent().args[0] as any)[
        SECTION_FEATURE_NAME
      ] as SectionState;
      expect(updated.entities['sOld']?.taskIds).toEqual(['unrelated']);
      // Target project section is untouched.
      expect(updated.entities['sOther']?.taskIds).toEqual([]);
      // Tag-context section keeps the parent — tag membership didn't change.
      expect(updated.entities['sTag']?.taskIds).toEqual(['parent']);
    });

    it('updateTask without tagIds change is a no-op for sections', () => {
      const state = stateWith({ t1: { tagIds: ['a'] } }, [
        {
          id: 'sa',
          contextId: 'a',
          contextType: WorkContextType.TAG,
          title: 'tag a',
          taskIds: ['t1'],
        },
      ]);

      metaReducer(
        state,
        TaskSharedActions.updateTask({
          task: { id: 't1', changes: { title: 'renamed' } },
        } as any),
      );

      expect(mockReducer.calls.mostRecent().args[0]).toBe(state);
    });
  });

  describe('TODAY-tag removal cleanup (diff-based)', () => {
    // The metaReducer compares pre/post TODAY_TAG.taskIds and strips any
    // ids that left TODAY from TODAY-context sections. We simulate the
    // tag reducer's effect by having the mock return a state where
    // TODAY's taskIds shrank.
    const stateWithTodayTaskIds = (
      todayTaskIds: string[],
      tasks: Record<string, Partial<Task>>,
      sections: Section[],
    ): RootState & { [SECTION_FEATURE_NAME]: SectionState } => {
      const base = stateWith(tasks, sections);
      return {
        ...base,
        [TAG_FEATURE_NAME]: {
          ...base[TAG_FEATURE_NAME],
          entities: {
            ...base[TAG_FEATURE_NAME].entities,
            [TODAY_TAG.id]: {
              ...base[TAG_FEATURE_NAME].entities[TODAY_TAG.id],
              taskIds: todayTaskIds,
            },
          },
        },
      } as any;
    };

    const mockTagReducerRemovesFromToday = (remainingTodayTaskIds: string[]): void => {
      mockReducer.and.callFake((s: any) => ({
        ...s,
        [TAG_FEATURE_NAME]: {
          ...s[TAG_FEATURE_NAME],
          entities: {
            ...s[TAG_FEATURE_NAME].entities,
            [TODAY_TAG.id]: {
              ...s[TAG_FEATURE_NAME].entities[TODAY_TAG.id],
              taskIds: remainingTodayTaskIds,
            },
          },
        },
      }));
    };

    it('strips taskIds that left TODAY from TODAY-context sections, leaving non-TODAY contexts alone', () => {
      const state = stateWithTodayTaskIds(
        ['t1', 't2', 't3'],
        { t1: {}, t2: {}, t3: {} },
        [
          {
            id: 'today-sec',
            contextId: TODAY_TAG.id,
            contextType: WorkContextType.TAG,
            title: 'Morning',
            taskIds: ['t1', 't2', 't3'],
          },
          {
            id: 'project-sec',
            contextId: 'p1',
            contextType: WorkContextType.PROJECT,
            title: 'Project',
            taskIds: ['t1', 't2'],
          },
        ],
      );
      mockTagReducerRemovesFromToday(['t2']);

      const result = metaReducer(state, { type: '[Tag] simulated removal' } as Action);

      const updated = (result as any)[SECTION_FEATURE_NAME] as SectionState;
      expect(updated.entities['today-sec']?.taskIds).toEqual(['t2']);
      // Project-context sections are intentionally not touched.
      expect(updated.entities['project-sec']?.taskIds).toEqual(['t1', 't2']);
    });

    it('cascades subtasks of a removed parent on TODAY removal', () => {
      const state = stateWithTodayTaskIds(
        ['parent', 'other'],
        {
          parent: { subTaskIds: ['sub1', 'sub2'] },
          sub1: { parentId: 'parent' },
          sub2: { parentId: 'parent' },
          other: {},
        },
        [
          {
            id: 'today-sec',
            contextId: TODAY_TAG.id,
            contextType: WorkContextType.TAG,
            title: 'Morning',
            taskIds: ['parent', 'sub1', 'other'],
          },
        ],
      );
      mockTagReducerRemovesFromToday(['other']);

      const result = metaReducer(state, { type: '[Tag] simulated removal' } as Action);

      const updated = (result as any)[SECTION_FEATURE_NAME] as SectionState;
      expect(updated.entities['today-sec']?.taskIds).toEqual(['other']);
    });
  });

  describe('removeTaskFromSection (atomic workContext reorder)', () => {
    it('repositions the task in the project taskIds at the given anchor', () => {
      const state = stateWith({ a: {}, b: {}, c: {} }, [
        {
          id: 's1',
          contextId: 'project1',
          contextType: WorkContextType.PROJECT,
          title: 'A',
          taskIds: ['c'],
        },
      ]);
      // project1 starts with [a, b, c] in workContext order
      (state as any)[PROJECT_FEATURE_NAME].entities.project1.taskIds = ['a', 'b', 'c'];

      metaReducer(
        state,
        removeTaskFromSection({
          sectionId: 's1',
          taskId: 'c',
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          // anchor 'a' → c lands right after a
          workContextAfterTaskId: 'a',
        }),
      );

      const projectState = (mockReducer.calls.mostRecent().args[0] as any)[
        PROJECT_FEATURE_NAME
      ];
      expect(projectState.entities.project1.taskIds).toEqual(['a', 'c', 'b']);
    });

    it('places at the start of the project taskIds when anchor is null', () => {
      const state = stateWith({ a: {}, b: {}, c: {} }, [
        {
          id: 's1',
          contextId: 'project1',
          contextType: WorkContextType.PROJECT,
          title: 'A',
          taskIds: ['c'],
        },
      ]);
      (state as any)[PROJECT_FEATURE_NAME].entities.project1.taskIds = ['a', 'b', 'c'];

      metaReducer(
        state,
        removeTaskFromSection({
          sectionId: 's1',
          taskId: 'c',
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          workContextAfterTaskId: null,
        }),
      );

      const projectState = (mockReducer.calls.mostRecent().args[0] as any)[
        PROJECT_FEATURE_NAME
      ];
      expect(projectState.entities.project1.taskIds).toEqual(['c', 'a', 'b']);
    });

    it('repositions in the TAG taskIds when workContextType is TAG', () => {
      const state = stateWith({ a: {}, b: {}, c: {} }, [
        {
          id: 's1',
          contextId: 'tag1',
          contextType: WorkContextType.TAG,
          title: 'A',
          taskIds: ['c'],
        },
      ]);
      (state as any)[TAG_FEATURE_NAME].entities.tag1.taskIds = ['a', 'b', 'c'];

      metaReducer(
        state,
        removeTaskFromSection({
          sectionId: 's1',
          taskId: 'c',
          workContextId: 'tag1',
          workContextType: WorkContextType.TAG,
          workContextAfterTaskId: 'a',
        }),
      );

      const tagState = (mockReducer.calls.mostRecent().args[0] as any)[TAG_FEATURE_NAME];
      expect(tagState.entities.tag1.taskIds).toEqual(['a', 'c', 'b']);
    });

    it('is a no-op when the work-context entity is missing', () => {
      const state = stateWith({ a: {} }, [
        {
          id: 's1',
          contextId: 'ghost',
          contextType: WorkContextType.PROJECT,
          title: 'A',
          taskIds: ['a'],
        },
      ]);

      const result = metaReducer(
        state,
        removeTaskFromSection({
          sectionId: 's1',
          taskId: 'a',
          workContextId: 'ghost',
          workContextType: WorkContextType.PROJECT,
          workContextAfterTaskId: null,
        }),
      );

      // Pre-state passed straight through — no project entity to mutate.
      expect((result as any)[PROJECT_FEATURE_NAME]).toBe(
        (state as any)[PROJECT_FEATURE_NAME],
      );
    });
  });
});
