import { Action } from '@ngrx/store';
import { isPersistentAction, PersistentAction } from './persistent-action.interface';
import { OpType } from './operation.types';

describe('PersistentAction Interface', () => {
  describe('isPersistentAction', () => {
    it('should return true for a valid PersistentAction', () => {
      const action: PersistentAction = {
        type: '[Test] Action',
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          opType: OpType.Create,
        },
      };
      expect(isPersistentAction(action)).toBe(true);
    });

    it('should return false for an action without meta', () => {
      const action: Action = {
        type: '[Test] Simple Action',
      };
      expect(isPersistentAction(action)).toBe(false);
    });

    it('should return false for an action with meta but isPersistent false', () => {
      const action = {
        type: '[Test] Non-persistent Action',
        meta: {
          isPersistent: false,
          entityType: 'TASK',
          opType: OpType.Create,
        },
      };
      expect(isPersistentAction(action as unknown as Action)).toBe(false);
    });

    it('should return false for an action with meta but isPersistent undefined', () => {
      const action = {
        type: '[Test] Undefined Persistence Action',
        meta: {
          entityType: 'TASK',
          opType: OpType.Create,
        },
      };
      expect(isPersistentAction(action as unknown as Action)).toBe(false);
    });

    it('should return false if action is null or undefined', () => {
      expect(isPersistentAction(null as any)).toBe(false);
      expect(isPersistentAction(undefined as any)).toBe(false);
    });

    it('should return false if action is not an object', () => {
      expect(isPersistentAction('string' as any)).toBe(false);
      expect(isPersistentAction(123 as any)).toBe(false);
    });
  });
});
