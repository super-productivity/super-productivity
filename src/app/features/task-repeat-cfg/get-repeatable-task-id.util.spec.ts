import { getRepeatableTaskId } from './get-repeatable-task-id.util';

describe('getRepeatableTaskId', () => {
  describe('valid inputs', () => {
    it('should generate deterministic ID from repeatCfgId and dueDay', () => {
      const id1 = getRepeatableTaskId('abc123', '2025-01-15');
      const id2 = getRepeatableTaskId('abc123', '2025-01-15');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different dueDays', () => {
      const id1 = getRepeatableTaskId('abc123', '2025-01-15');
      const id2 = getRepeatableTaskId('abc123', '2025-01-16');
      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different repeatCfgIds', () => {
      const id1 = getRepeatableTaskId('abc123', '2025-01-15');
      const id2 = getRepeatableTaskId('xyz789', '2025-01-15');
      expect(id1).not.toBe(id2);
    });

    it('should have the expected format with rpt_ prefix', () => {
      const id = getRepeatableTaskId('myConfigId', '2025-12-31');
      expect(id).toBe('rpt_myConfigId_2025-12-31');
    });

    it('should handle long repeatCfgIds', () => {
      const longId = 'a'.repeat(100);
      const id = getRepeatableTaskId(longId, '2025-01-01');
      expect(id).toBe(`rpt_${longId}_2025-01-01`);
    });

    it('should handle config IDs with special characters', () => {
      const id = getRepeatableTaskId('cfg-with_special.chars', '2025-01-15');
      expect(id).toBe('rpt_cfg-with_special.chars_2025-01-15');
    });
  });

  describe('input validation', () => {
    it('should throw for empty repeatCfgId', () => {
      expect(() => getRepeatableTaskId('', '2025-01-15')).toThrowError(
        /repeatCfgId must be a non-empty string/,
      );
    });

    it('should throw for null repeatCfgId', () => {
      expect(() =>
        getRepeatableTaskId(null as unknown as string, '2025-01-15'),
      ).toThrowError(/repeatCfgId must be a non-empty string/);
    });

    it('should throw for undefined repeatCfgId', () => {
      expect(() =>
        getRepeatableTaskId(undefined as unknown as string, '2025-01-15'),
      ).toThrowError(/repeatCfgId must be a non-empty string/);
    });

    it('should throw for empty dueDay', () => {
      expect(() => getRepeatableTaskId('cfg-1', '')).toThrowError(
        /dueDay must be in YYYY-MM-DD format/,
      );
    });

    it('should throw for null dueDay', () => {
      expect(() => getRepeatableTaskId('cfg-1', null as unknown as string)).toThrowError(
        /dueDay must be in YYYY-MM-DD format/,
      );
    });

    it('should throw for invalid date format - wrong separator', () => {
      expect(() => getRepeatableTaskId('cfg-1', '2025/01/15')).toThrowError(
        /dueDay must be in YYYY-MM-DD format/,
      );
    });

    it('should throw for invalid date format - missing parts', () => {
      expect(() => getRepeatableTaskId('cfg-1', '2025-01')).toThrowError(
        /dueDay must be in YYYY-MM-DD format/,
      );
    });

    it('should throw for invalid date format - extra parts', () => {
      expect(() => getRepeatableTaskId('cfg-1', '2025-01-15T12:00:00')).toThrowError(
        /dueDay must be in YYYY-MM-DD format/,
      );
    });

    it('should throw for invalid date format - text', () => {
      expect(() => getRepeatableTaskId('cfg-1', 'January 15, 2025')).toThrowError(
        /dueDay must be in YYYY-MM-DD format/,
      );
    });
  });
});
