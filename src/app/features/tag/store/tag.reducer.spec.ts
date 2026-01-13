import { computeOrderedTaskIdsForTag, initialTagState, tagReducer } from './tag.reducer';
import { Tag } from '../tag.model';
import { addTag } from './tag.actions';
import { TODAY_TAG } from '../tag.const';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DEFAULT_TASK } from '../../tasks/task.model';
import * as getDbDateStrUtil from '../../../util/get-db-date-str';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';

/* eslint-disable @typescript-eslint/naming-convention */

describe('TagReducer', () => {
  describe('standard', () => {
    let initialState;

    beforeEach(() => {
      initialState = {
        ...initialTagState,
        entities: {
          '1': {
            id: '1',
            title: 'Test Tag',
            taskIds: ['task1', 'task2'],
          } as Tag,
          [TODAY_TAG.id]: TODAY_TAG,
        },
      };
    });

    it('should handle addTag action', () => {
      const newTag: Tag = {
        id: '2',
        title: 'New Tag',
        taskIds: [],
      } as any as Tag;
      const action = addTag({ tag: newTag });
      const state = tagReducer(initialState, action);

      expect(state.entities['2']).toEqual(newTag);
    });
  });

  describe('planTaskForDay', () => {
    it('should add new task to today tag when planning for today', () => {
      const todayStr = getDbDateStrUtil.getDbDateStr();
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['task1', 'task2'],
          },
        },
      };

      const action = PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 'task3', projectId: 'test', subTaskIds: [] },
        day: todayStr,
        isAddToTop: false,
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual([
        'task1',
        'task2',
        'task3',
      ]);
    });

    it('should add task to top of today tag when isAddToTop is true', () => {
      const todayStr = getDbDateStrUtil.getDbDateStr();
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['task1', 'task2'],
          },
        },
      };

      const action = PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 'task3', projectId: 'test', subTaskIds: [] },
        day: todayStr,
        isAddToTop: true,
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual([
        'task3',
        'task1',
        'task2',
      ]);
    });

    it('should handle reordering existing task within today tag', () => {
      const todayStr = getDbDateStrUtil.getDbDateStr();
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['task1', 'task2', 'task3'],
          },
        },
      };

      const action = PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 'task1', projectId: 'test', subTaskIds: [] },
        day: todayStr,
        isAddToTop: false, // move to end
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual([
        'task2',
        'task3',
        'task1',
      ]);
    });

    it('should remove task from today tag when planning for future day', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['task1', 'task2', 'task3'],
          },
        },
      };

      const action = PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 'task2', projectId: 'test', subTaskIds: [] },
        day: '2024-01-16', // future day
        isAddToTop: false,
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual(['task1', 'task3']);
    });

    it('should not modify state when planning for future day with task not in today', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['task1', 'task2'],
          },
        },
      };

      const action = PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 'task3', projectId: 'test', subTaskIds: [] },
        day: '2024-01-16', // future day
        isAddToTop: false,
      });

      const result = tagReducer(initialState, action);
      expect(result).toBe(initialState);
    });

    it('should not duplicate task when already in today list', () => {
      const todayStr = getDbDateStrUtil.getDbDateStr();
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['task1', 'task2'],
          },
        },
      };

      const action = PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 'task1', projectId: 'test', subTaskIds: [] },
        day: todayStr,
        isAddToTop: false,
      });

      const result = tagReducer(initialState, action);
      const taskIds = (result.entities[TODAY_TAG.id] as Tag).taskIds;
      expect(taskIds).toEqual(['task2', 'task1']);
      expect(taskIds.filter((id) => id === 'task1').length).toBe(1);
    });
  });

  describe('moveTaskInTodayList (anchor-based)', () => {
    it('should move task to start of list when afterTaskId is null and target is UNDONE', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['A', 'B', 'C'],
          },
        },
      };

      const action = moveTaskInTodayList({
        taskId: 'C',
        afterTaskId: null,
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
        src: 'UNDONE',
        target: 'UNDONE',
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual(['C', 'A', 'B']);
    });

    it('should move task after specified anchor', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['A', 'B', 'C'],
          },
        },
      };

      const action = moveTaskInTodayList({
        taskId: 'C',
        afterTaskId: 'A',
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
        src: 'UNDONE',
        target: 'UNDONE',
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual(['A', 'C', 'B']);
    });

    it('should move task to end of list when anchor is last item', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['A', 'B', 'C'],
          },
        },
      };

      const action = moveTaskInTodayList({
        taskId: 'A',
        afterTaskId: 'C',
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
        src: 'UNDONE',
        target: 'UNDONE',
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual(['B', 'C', 'A']);
    });

    it('should append task to end when afterTaskId is null and target is DONE', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['A', 'B', 'C'],
          },
        },
      };

      const action = moveTaskInTodayList({
        taskId: 'A',
        afterTaskId: null,
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
        src: 'UNDONE',
        target: 'DONE',
      });

      const result = tagReducer(initialState, action);
      expect((result.entities[TODAY_TAG.id] as Tag).taskIds).toEqual(['B', 'C', 'A']);
    });

    it('should not modify state when workContextType is PROJECT', () => {
      const initialState = {
        ...initialTagState,
        entities: {
          ...initialTagState.entities,
          [TODAY_TAG.id]: {
            ...TODAY_TAG,
            taskIds: ['A', 'B', 'C'],
          },
        },
      };

      const action = moveTaskInTodayList({
        taskId: 'C',
        afterTaskId: null,
        workContextType: WorkContextType.PROJECT,
        workContextId: 'some-project',
        src: 'UNDONE',
        target: 'UNDONE',
      });

      const result = tagReducer(initialState, action);
      expect(result).toBe(initialState);
    });
  });

  describe('computeOrderedTaskIdsForTag (board-style hybrid pattern)', () => {
    const createTag = (taskIds: string[]): Tag =>
      ({
        id: 'tag1',
        title: 'Test Tag',
        taskIds,
      }) as Tag;

    const createTaskEntities = (
      tasks: Array<{ id: string; tagIds: string[]; parentId?: string | null }>,
    ): Record<string, { id: string; tagIds: string[]; parentId?: string | null }> => {
      const entities: Record<
        string,
        { id: string; tagIds: string[]; parentId?: string | null }
      > = {};
      for (const task of tasks) {
        entities[task.id] = task;
      }
      return entities;
    };

    it('should return empty array when tag is undefined', () => {
      const result = computeOrderedTaskIdsForTag('tag1', undefined, {});
      expect(result).toEqual([]);
    });

    it('should return empty array when no tasks have the tag', () => {
      const tag = createTag(['task1', 'task2']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['otherTag'] },
        { id: 'task2', tagIds: [] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual([]);
    });

    it('should return tasks in stored order when all tasks exist and have the tag', () => {
      const tag = createTag(['task1', 'task2', 'task3']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        { id: 'task2', tagIds: ['tag1'] },
        { id: 'task3', tagIds: ['tag1'] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1', 'task2', 'task3']);
    });

    it('should filter out stale taskIds (tasks that no longer have the tag)', () => {
      const tag = createTag(['task1', 'task2', 'task3']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        { id: 'task2', tagIds: [] }, // Tag was removed from this task
        { id: 'task3', tagIds: ['tag1'] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1', 'task3']);
    });

    it('should filter out taskIds for deleted tasks', () => {
      const tag = createTag(['task1', 'task2', 'task3']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        // task2 is deleted (not in entities)
        { id: 'task3', tagIds: ['tag1'] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1', 'task3']);
    });

    it('should auto-add tasks with tagId but not in stored order (append at end)', () => {
      const tag = createTag(['task1', 'task2']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        { id: 'task2', tagIds: ['tag1'] },
        { id: 'task3', tagIds: ['tag1'] }, // Has tag but not in taskIds
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1', 'task2', 'task3']);
    });

    it('should handle mixed scenario: stale IDs + missing from order', () => {
      const tag = createTag(['task1', 'task2', 'task3']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        { id: 'task2', tagIds: [] }, // Stale - tag removed
        { id: 'task3', tagIds: ['tag1'] },
        { id: 'task4', tagIds: ['tag1'] }, // New - not in order
        { id: 'task5', tagIds: ['tag1'] }, // New - not in order
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1', 'task3', 'task4', 'task5']);
    });

    it('should exclude subtasks (tasks with parentId)', () => {
      const tag = createTag(['task1', 'subtask1']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        { id: 'subtask1', tagIds: ['tag1'], parentId: 'task1' }, // Subtask
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1']);
    });

    it('should preserve sparse ordering (gaps in index)', () => {
      // If stored order is ['A', 'B', 'C'] and B is stale,
      // result should be ['A', 'C'] preserving relative order
      const tag = createTag(['A', 'B', 'C']);
      const taskEntities = createTaskEntities([
        { id: 'A', tagIds: ['tag1'] },
        { id: 'B', tagIds: [] }, // Stale
        { id: 'C', tagIds: ['tag1'] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['A', 'C']);
    });

    it('should handle empty stored order with tasks that have the tag', () => {
      const tag = createTag([]);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1'] },
        { id: 'task2', tagIds: ['tag1'] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      // All tasks go to unordered, appended at end
      expect(result).toEqual(['task1', 'task2']);
    });

    it('should handle task with multiple tags', () => {
      const tag = createTag(['task1', 'task2']);
      const taskEntities = createTaskEntities([
        { id: 'task1', tagIds: ['tag1', 'tag2', 'tag3'] },
        { id: 'task2', tagIds: ['tag1'] },
      ]);

      const result = computeOrderedTaskIdsForTag('tag1', tag, taskEntities);
      expect(result).toEqual(['task1', 'task2']);
    });
  });
});
