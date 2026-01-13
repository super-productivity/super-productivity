import { ActionType } from './action-types.enum';
import {
  ACTION_TYPE_TO_CODE,
  CODE_TO_ACTION_TYPE,
} from '../../core/persistence/operation-log/compact/action-type-codes';

/**
 * These tests verify that the ActionType enum values are stable and match
 * the encoding system. If any string value changes, these tests will fail.
 */
describe('ActionType enum', () => {
  const enumValues = Object.values(ActionType) as string[];
  const mappingKeys = Object.keys(ACTION_TYPE_TO_CODE);

  it('should have exactly 131 members', () => {
    expect(enumValues.length).toBe(131);
  });

  it('should have 1:1 correspondence with ACTION_TYPE_TO_CODE', () => {
    // Every enum value must exist as a key in the mapping
    expect(new Set(enumValues)).toEqual(new Set(mappingKeys));
  });

  it('should round-trip through encoding/decoding', () => {
    // If any string changed, this would fail
    for (const actionType of enumValues) {
      const code = ACTION_TYPE_TO_CODE[actionType as ActionType];
      const decoded = CODE_TO_ACTION_TYPE[code];
      expect(decoded).toBe(actionType);
    }
  });

  it('should preserve format pattern [Source] action', () => {
    for (const actionType of enumValues) {
      expect(actionType).toMatch(/^\[.+\] .+$/);
    }
  });

  // Spot-check critical action types to catch copy-paste errors
  describe('critical action type values', () => {
    it('should have correct Task Shared action types', () => {
      expect(ActionType.TASK_SHARED_ADD).toBe('[Task Shared] addTask');
      expect(ActionType.TASK_SHARED_UPDATE).toBe('[Task Shared] updateTask');
      expect(ActionType.TASK_SHARED_DELETE).toBe('[Task Shared] deleteTask');
    });

    it('should have correct Tag action types', () => {
      expect(ActionType.TAG_ADD).toBe('[Tag] Add Tag');
      expect(ActionType.TAG_UPDATE).toBe('[Tag] Update Tag');
      expect(ActionType.TAG_DELETE).toBe('[Tag] Delete Tag');
    });

    it('should have correct Project action types', () => {
      expect(ActionType.PROJECT_ADD).toBe('[Project] Add Project');
      expect(ActionType.PROJECT_UPDATE).toBe('[Project] Update Project');
    });

    it('should handle inconsistent spacing in SimpleCounter', () => {
      // Note: One action has '[Simple Counter]' (with space), others have '[SimpleCounter]'
      expect(ActionType.COUNTER_SET_FOR_DATE).toBe(
        '[Simple Counter] Set SimpleCounter Counter For Date',
      );
      expect(ActionType.COUNTER_ADD).toBe('[SimpleCounter] Add SimpleCounter');
    });
  });
});
