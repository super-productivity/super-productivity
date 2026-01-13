import { SyncStateCorruptedError } from './sync-state-corrupted.error';
import { ActionType } from './action-types.enum';

describe('SyncStateCorruptedError', () => {
  it('should create error with message and context', () => {
    const error = new SyncStateCorruptedError('Test error message', {
      opId: 'op-123',
      actionType: '[Task] Add Task' as ActionType,
      missingDependencies: ['project-1', 'tag-2'],
    });

    expect(error.message).toBe('Test error message');
    expect(error.name).toBe('SyncStateCorruptedError');
    expect(error.context.opId).toBe('op-123');
    expect(error.context.actionType).toBe('[Task] Add Task');
    expect(error.context.missingDependencies).toEqual(['project-1', 'tag-2']);
  });

  it('should be instanceof Error', () => {
    const error = new SyncStateCorruptedError('Test', {
      opId: 'op-1',
      actionType: 'test' as ActionType,
      missingDependencies: [],
    });

    expect(error instanceof Error).toBe(true);
    expect(error instanceof SyncStateCorruptedError).toBe(true);
  });

  it('should have proper stack trace', () => {
    const error = new SyncStateCorruptedError('Stack test', {
      opId: 'op-1',
      actionType: 'test' as ActionType,
      missingDependencies: [],
    });

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('SyncStateCorruptedError');
  });

  it('should handle empty missing dependencies', () => {
    const error = new SyncStateCorruptedError('No deps', {
      opId: 'op-1',
      actionType: 'test' as ActionType,
      missingDependencies: [],
    });

    expect(error.context.missingDependencies).toEqual([]);
  });
});
