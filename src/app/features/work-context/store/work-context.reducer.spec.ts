import { workContextReducer, initialContextState } from './work-context.reducer';
import * as WorkContextActions from './work-context.actions';
import { WorkContextState, WorkContextType } from '../work-context.model';
import { TODAY_TAG } from '../../tag/tag.const';

describe('WorkContextReducer', () => {
  describe('initial state', () => {
    it('should return initial state for unknown action', () => {
      const action = { type: 'UNKNOWN' };
      const result = workContextReducer(undefined, action);

      expect(result).toEqual(initialContextState);
    });

    it('should initialize with TODAY_TAG.id as activeId', () => {
      const result = workContextReducer(undefined, { type: 'UNKNOWN' });

      expect(result.activeId).toBe(TODAY_TAG.id);
    });

    it('should initialize with WorkContextType.TAG as activeType', () => {
      const result = workContextReducer(undefined, { type: 'UNKNOWN' });

      expect(result.activeType).toBe(WorkContextType.TAG);
    });
  });

  describe('setActiveWorkContext', () => {
    it('should update activeId', () => {
      const action = WorkContextActions.setActiveWorkContext({
        activeId: 'project-123',
        activeType: WorkContextType.PROJECT,
      });
      const result = workContextReducer(initialContextState, action);

      expect(result.activeId).toBe('project-123');
    });

    it('should update activeType', () => {
      const action = WorkContextActions.setActiveWorkContext({
        activeId: 'project-123',
        activeType: WorkContextType.PROJECT,
      });
      const result = workContextReducer(initialContextState, action);

      expect(result.activeType).toBe(WorkContextType.PROJECT);
    });

    it('should switch from PROJECT to TAG', () => {
      const projectState: WorkContextState = {
        activeId: 'project-123',
        activeType: WorkContextType.PROJECT,
      };
      const action = WorkContextActions.setActiveWorkContext({
        activeId: 'tag-456',
        activeType: WorkContextType.TAG,
      });
      const result = workContextReducer(projectState, action);

      expect(result.activeId).toBe('tag-456');
      expect(result.activeType).toBe(WorkContextType.TAG);
    });

    it('should preserve state immutability (create new object)', () => {
      const action = WorkContextActions.setActiveWorkContext({
        activeId: 'project-123',
        activeType: WorkContextType.PROJECT,
      });
      const result = workContextReducer(initialContextState, action);

      expect(result).not.toBe(initialContextState);
    });
  });

  describe('loadWorkContextState', () => {
    it('should merge complete state', () => {
      const loadedState: WorkContextState = {
        activeId: 'loaded-project',
        activeType: WorkContextType.PROJECT,
      };
      const action = WorkContextActions.loadWorkContextState({ state: loadedState });
      const result = workContextReducer(initialContextState, action);

      expect(result.activeId).toBe('loaded-project');
      expect(result.activeType).toBe(WorkContextType.PROJECT);
    });

    it('should merge partial state with only activeId', () => {
      const partialState = { activeId: 'new-id' } as WorkContextState;
      const action = WorkContextActions.loadWorkContextState({ state: partialState });
      const result = workContextReducer(initialContextState, action);

      expect(result.activeId).toBe('new-id');
      expect(result.activeType).toBe(initialContextState.activeType);
    });

    it('should merge partial state with only activeType', () => {
      const partialState = { activeType: WorkContextType.PROJECT } as WorkContextState;
      const action = WorkContextActions.loadWorkContextState({ state: partialState });
      const result = workContextReducer(initialContextState, action);

      expect(result.activeId).toBe(initialContextState.activeId);
      expect(result.activeType).toBe(WorkContextType.PROJECT);
    });

    it('should preserve existing state when merging empty object', () => {
      const customState: WorkContextState = {
        activeId: 'custom-id',
        activeType: WorkContextType.PROJECT,
      };
      const action = WorkContextActions.loadWorkContextState({
        state: {} as WorkContextState,
      });
      const result = workContextReducer(customState, action);

      expect(result.activeId).toBe('custom-id');
      expect(result.activeType).toBe(WorkContextType.PROJECT);
    });
  });
});
