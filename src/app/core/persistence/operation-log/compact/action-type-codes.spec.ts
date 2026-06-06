import {
  ACTION_TYPE_TO_CODE,
  CODE_TO_ACTION_TYPE,
  decodeActionType,
  encodeActionType,
} from './action-type-codes';

describe('action-type-codes', () => {
  describe('ACTION_TYPE_TO_CODE', () => {
    it('should have unique codes for all action types', () => {
      const codes = Object.values(ACTION_TYPE_TO_CODE);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('should have codes of 2-3 characters', () => {
      for (const [actionType, code] of Object.entries(ACTION_TYPE_TO_CODE)) {
        expect(code.length).toBeGreaterThanOrEqual(2);
        expect(code.length).toBeLessThanOrEqual(3);
        if (code.length < 2 || code.length > 3) {
          fail(`Code "${code}" for "${actionType}" is not 2-3 chars`);
        }
      }
    });
  });

  describe('CODE_TO_ACTION_TYPE', () => {
    it('should be the inverse of ACTION_TYPE_TO_CODE', () => {
      expect(Object.keys(CODE_TO_ACTION_TYPE).length).toBe(
        Object.keys(ACTION_TYPE_TO_CODE).length,
      );

      for (const [actionType, code] of Object.entries(ACTION_TYPE_TO_CODE)) {
        expect(CODE_TO_ACTION_TYPE[code]).toBe(actionType);
      }
    });
  });

  describe('encodeActionType', () => {
    it('should encode known action types', () => {
      expect(encodeActionType('[Task Shared] addTask')).toBe('HA');
      expect(encodeActionType('[Tag] Add Tag')).toBe('GA');
      expect(encodeActionType('[Project] Add Project')).toBe('PA');
    });

    it('should return original action type for unknown action types', () => {
      expect(encodeActionType('[Unknown] Action')).toBe('[Unknown] Action');
      expect(encodeActionType('[Task] Update')).toBe('[Task] Update');
    });
  });

  describe('decodeActionType', () => {
    it('should decode known codes', () => {
      expect(decodeActionType('HA')).toBe('[Task Shared] addTask');
      expect(decodeActionType('GA')).toBe('[Tag] Add Tag');
      expect(decodeActionType('PA')).toBe('[Project] Add Project');
    });

    it('should return code as-is for unknown codes (assumed to be full action type)', () => {
      expect(decodeActionType('[Unknown] Action')).toBe('[Unknown] Action');
      expect(decodeActionType('[Task] Update')).toBe('[Task] Update');
    });
  });

  describe('round-trip encoding', () => {
    it('should round-trip all action types', () => {
      for (const actionType of Object.keys(ACTION_TYPE_TO_CODE)) {
        const code = encodeActionType(actionType);
        const decoded = decodeActionType(code);
        expect(decoded).toBe(actionType);
      }
    });
  });
});
