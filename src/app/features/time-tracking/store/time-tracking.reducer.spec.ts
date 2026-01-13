/* eslint-disable @typescript-eslint/naming-convention */
import { initialTimeTrackingState, timeTrackingReducer } from './time-tracking.reducer';
import {
  TimeTrackingActions,
  updateWorkContextData,
  syncTimeTracking,
} from './time-tracking.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { TaskCopy } from '../../tasks/task.model';
import { WorkContextType } from '../../work-context/work-context.model';

describe('TimeTracking Reducer', () => {
  it('should return the previous state for an unknown action', () => {
    const action = {} as any;
    const result = timeTrackingReducer(initialTimeTrackingState, action);
    expect(result).toBe(initialTimeTrackingState);
  });

  it('should load all data', () => {
    const appDataComplete: AppDataComplete = {
      timeTracking: {
        project: { '1': { '2023-01-01': { s: 1, e: 2, b: 3, bt: 4 } } },
        tag: { '2': { '2023-01-02': { s: 5, e: 6, b: 7, bt: 8 } } },
      },
    } as Partial<AppDataComplete> as AppDataComplete;
    const action = loadAllData({ appDataComplete });
    const result = timeTrackingReducer(initialTimeTrackingState, action);
    expect(result).toEqual(appDataComplete.timeTracking);
  });

  it('should update the whole state', () => {
    const newState = {
      project: { '1': { '2023-01-01': { s: 1, e: 2, b: 3, bt: 4 } } },
      tag: { '2': { '2023-01-02': { s: 5, e: 6, b: 7, bt: 8 } } },
    };
    const action = TimeTrackingActions.updateWholeState({ newState });
    const result = timeTrackingReducer(initialTimeTrackingState, action);
    expect(result).toEqual(newState);
  });

  describe('addTimeSpent', () => {
    it('should add time spent for project and single tag', () => {
      const task = { projectId: '1', tagIds: ['2'] } as Partial<TaskCopy> as TaskCopy;
      const date = '2023-01-01';
      const action = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 223,
        isFromTrackingReminder: false,
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);
      expect(result.project['1'][date].s).toBeDefined();
      expect(result.project['1'][date].e).toBeDefined();
      expect(result.tag['2'][date].s).toBeDefined();
      expect(result.tag['2'][date].e).toBeDefined();
    });

    it('should add time spent for multiple tags (including TODAY_TAG)', () => {
      const task = {
        projectId: 'proj-1',
        tagIds: ['tag-1', 'tag-2', 'tag-3'],
      } as Partial<TaskCopy> as TaskCopy;
      const date = '2024-01-15';
      const action = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 300,
        isFromTrackingReminder: false,
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      // Project should have entry
      expect(result.project['proj-1'][date].s).toBeDefined();
      expect(result.project['proj-1'][date].e).toBeDefined();

      // All tags should have entries
      expect(result.tag['tag-1'][date].s).toBeDefined();
      expect(result.tag['tag-2'][date].s).toBeDefined();
      expect(result.tag['tag-3'][date].s).toBeDefined();

      // TODAY_TAG should also have entry (id is 'TODAY')
      expect(result.tag['TODAY'][date].s).toBeDefined();
      expect(result.tag['TODAY'][date].e).toBeDefined();
    });

    it('should handle empty tagIds array gracefully', () => {
      const task = {
        projectId: 'proj-1',
        tagIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const date = '2024-01-15';
      const action = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 100,
        isFromTrackingReminder: false,
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      // Project should have entry
      expect(result.project['proj-1'][date].s).toBeDefined();

      // Only TODAY_TAG should have entry (no other tags)
      expect(result.tag['TODAY'][date].s).toBeDefined();
      expect(Object.keys(result.tag)).toEqual(['TODAY']);
    });

    it('should handle null/undefined tagIds defensively', () => {
      // This tests the defensive coding for corrupted data
      const task = {
        projectId: 'proj-1',
        tagIds: null as unknown as string[],
      } as Partial<TaskCopy> as TaskCopy;
      const date = '2024-01-15';
      const action = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 100,
        isFromTrackingReminder: false,
      });

      // Should not throw - defensive coding handles null
      expect(() => timeTrackingReducer(initialTimeTrackingState, action)).not.toThrow();

      const result = timeTrackingReducer(initialTimeTrackingState, action);
      expect(result.project['proj-1'][date].s).toBeDefined();
      expect(result.tag['TODAY'][date].s).toBeDefined();
    });

    it('should merge time when called multiple times for same task/date', () => {
      const task = {
        projectId: 'proj-1',
        tagIds: ['tag-1'],
      } as Partial<TaskCopy> as TaskCopy;
      const date = '2024-01-15';

      // First call
      const action1 = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 100,
        isFromTrackingReminder: false,
      });
      const state1 = timeTrackingReducer(initialTimeTrackingState, action1);
      const firstStartTime = state1.project['proj-1'][date].s;
      expect(firstStartTime).toBeDefined();

      // Second call (simulating continued work)
      const action2 = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 200,
        isFromTrackingReminder: false,
      });
      const state2 = timeTrackingReducer(state1, action2);

      // Start time should be preserved from first call
      expect(state2.project['proj-1'][date].s).toBe(firstStartTime);
      // End time should be updated (greater than or equal to start)
      expect(state2.project['proj-1'][date].e).toBeGreaterThanOrEqual(firstStartTime!);
    });

    it('should work for task without projectId (only tags)', () => {
      const task = {
        projectId: null as unknown as string,
        tagIds: ['tag-1'],
      } as Partial<TaskCopy> as TaskCopy;
      const date = '2024-01-15';
      const action = TimeTrackingActions.addTimeSpent({
        task,
        date,
        duration: 100,
        isFromTrackingReminder: false,
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      // Project should NOT have entry (no projectId)
      expect(result.project).toEqual({});

      // Tags should have entries
      expect(result.tag['tag-1'][date].s).toBeDefined();
      expect(result.tag['TODAY'][date].s).toBeDefined();
    });
  });

  it('should update work context data', () => {
    // Set up a custom initial state with the required structure
    const customInitialState = {
      ...initialTimeTrackingState,
      project: { '1': { '2023-01-01': { s: 0, e: 0 } } },
    };

    const ctx = { id: '1', type: 'PROJECT' as WorkContextType };
    const date = '2023-01-01';
    const updates = { s: 10, e: 20 };
    const action = updateWorkContextData({ ctx, date, updates });
    const result = timeTrackingReducer(customInitialState, action);

    expect(result.project['1'][date].s).toBe(10);
    expect(result.project['1'][date].e).toBe(20);
  });

  it('should update work context data for a tag', () => {
    // Set up a custom initial state with the required structure
    const customInitialState = {
      ...initialTimeTrackingState,
      tag: { '2': { '2023-01-02': { s: 0, e: 0 } } },
    };

    const ctx = { id: '2', type: 'TAG' as WorkContextType };
    const date = '2023-01-02';
    const updates = { s: 30, e: 40 };
    const action = updateWorkContextData({ ctx, date, updates });
    const result = timeTrackingReducer(customInitialState, action);

    expect(result.tag['2'][date].s).toBe(30);
    expect(result.tag['2'][date].e).toBe(40);
  });

  describe('syncTimeTracking', () => {
    it('should sync time tracking data for a PROJECT context', () => {
      const action = syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'proj-1',
        date: '2024-01-15',
        data: { s: 1000, e: 2000, b: 1, bt: 100 },
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      expect(result.project['proj-1']['2024-01-15']).toEqual({
        s: 1000,
        e: 2000,
        b: 1,
        bt: 100,
      });
    });

    it('should sync time tracking data for a TAG context', () => {
      const action = syncTimeTracking({
        contextType: 'TAG',
        contextId: 'tag-1',
        date: '2024-01-15',
        data: { s: 3000, e: 4000 },
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      expect(result.tag['tag-1']['2024-01-15']).toEqual({ s: 3000, e: 4000 });
    });

    it('should replace existing data when syncing', () => {
      const customInitialState = {
        ...initialTimeTrackingState,
        tag: { 'tag-1': { '2024-01-15': { s: 100, e: 200 } } },
      };

      const action = syncTimeTracking({
        contextType: 'TAG',
        contextId: 'tag-1',
        date: '2024-01-15',
        data: { s: 5000, e: 6000, b: 2, bt: 300 },
      });
      const result = timeTrackingReducer(customInitialState, action);

      expect(result.tag['tag-1']['2024-01-15']).toEqual({
        s: 5000,
        e: 6000,
        b: 2,
        bt: 300,
      });
    });

    it('should preserve other dates when syncing', () => {
      const customInitialState = {
        ...initialTimeTrackingState,
        project: {
          'proj-1': {
            '2024-01-14': { s: 100, e: 200 },
            '2024-01-15': { s: 300, e: 400 },
          },
        },
      };

      const action = syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'proj-1',
        date: '2024-01-15',
        data: { s: 9000, e: 10000 },
      });
      const result = timeTrackingReducer(customInitialState, action);

      expect(result.project['proj-1']['2024-01-14']).toEqual({ s: 100, e: 200 });
      expect(result.project['proj-1']['2024-01-15']).toEqual({ s: 9000, e: 10000 });
    });

    it('should preserve other contexts when syncing', () => {
      // Ensure syncing one context does not affect other contexts
      const customInitialState = {
        ...initialTimeTrackingState,
        project: {
          'proj-1': { '2024-01-15': { s: 100, e: 200 } },
          'proj-2': { '2024-01-15': { s: 300, e: 400 } },
        },
        tag: {
          'tag-1': { '2024-01-15': { s: 500, e: 600 } },
        },
      };

      const action = syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'proj-1',
        date: '2024-01-15',
        data: { s: 9999, e: 9999 },
      });
      const result = timeTrackingReducer(customInitialState, action);

      // proj-1 should be updated
      expect(result.project['proj-1']['2024-01-15']).toEqual({ s: 9999, e: 9999 });
      // proj-2 should be unchanged
      expect(result.project['proj-2']['2024-01-15']).toEqual({ s: 300, e: 400 });
      // tag-1 should be unchanged
      expect(result.tag['tag-1']['2024-01-15']).toEqual({ s: 500, e: 600 });
    });

    it('should create new context if it does not exist', () => {
      const action = syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'new-proj',
        date: '2024-01-15',
        data: { s: 1000, e: 2000 },
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      expect(result.project['new-proj']).toBeDefined();
      expect(result.project['new-proj']['2024-01-15']).toEqual({ s: 1000, e: 2000 });
    });

    it('should create new date for existing context', () => {
      const customInitialState = {
        ...initialTimeTrackingState,
        project: {
          'proj-1': { '2024-01-14': { s: 100, e: 200 } },
        },
      };

      const action = syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'proj-1',
        date: '2024-01-16', // New date
        data: { s: 500, e: 600 },
      });
      const result = timeTrackingReducer(customInitialState, action);

      // Both dates should exist
      expect(result.project['proj-1']['2024-01-14']).toEqual({ s: 100, e: 200 });
      expect(result.project['proj-1']['2024-01-16']).toEqual({ s: 500, e: 600 });
    });
  });

  describe('immutability', () => {
    it('should not mutate the original state when syncing', () => {
      const originalState = {
        ...initialTimeTrackingState,
        project: {
          'proj-1': { '2024-01-15': { s: 100, e: 200 } },
        },
      };
      const originalProjectData = originalState.project['proj-1']['2024-01-15'];

      const action = syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'proj-1',
        date: '2024-01-15',
        data: { s: 9999, e: 9999 },
      });
      const result = timeTrackingReducer(originalState, action);

      // Original should be unchanged
      expect(originalProjectData).toEqual({ s: 100, e: 200 });
      // Result should be different
      expect(result.project['proj-1']['2024-01-15']).toEqual({ s: 9999, e: 9999 });
      // Result should be a new object
      expect(result).not.toBe(originalState);
      expect(result.project).not.toBe(originalState.project);
    });

    it('should not mutate original state when updating work context data', () => {
      const originalState = {
        ...initialTimeTrackingState,
        tag: { 'tag-1': { '2024-01-15': { s: 100, e: 200 } } },
      };

      const action = updateWorkContextData({
        ctx: { id: 'tag-1', type: 'TAG' as WorkContextType },
        date: '2024-01-15',
        updates: { b: 5, bt: 50 },
      });
      const result = timeTrackingReducer(originalState, action);

      // Original should be unchanged
      expect(originalState.tag['tag-1']['2024-01-15']).toEqual({ s: 100, e: 200 });
      // Result should have merged values
      expect(result.tag['tag-1']['2024-01-15']).toEqual({ s: 100, e: 200, b: 5, bt: 50 });
    });
  });

  describe('updateWorkContextData deep structure', () => {
    it('should merge updates with existing data (not replace)', () => {
      const customInitialState = {
        ...initialTimeTrackingState,
        project: {
          'proj-1': { '2024-01-15': { s: 100, e: 200, b: 1 } },
        },
      };

      const action = updateWorkContextData({
        ctx: { id: 'proj-1', type: 'PROJECT' as WorkContextType },
        date: '2024-01-15',
        updates: { bt: 50 }, // Only updating bt
      });
      const result = timeTrackingReducer(customInitialState, action);

      // All fields should be present
      expect(result.project['proj-1']['2024-01-15']).toEqual({
        s: 100,
        e: 200,
        b: 1,
        bt: 50,
      });
    });

    it('should create context and date if they do not exist for updateWorkContextData', () => {
      const action = updateWorkContextData({
        ctx: { id: 'new-proj', type: 'PROJECT' as WorkContextType },
        date: '2024-01-20',
        updates: { s: 500 },
      });
      const result = timeTrackingReducer(initialTimeTrackingState, action);

      expect(result.project['new-proj']).toBeDefined();
      expect(result.project['new-proj']['2024-01-20']).toEqual({ s: 500 });
    });
  });
});
