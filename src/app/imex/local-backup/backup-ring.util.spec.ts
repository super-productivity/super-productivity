import { isUsableBackupStr, selectBestBackupStr } from './backup-ring.util';

const MEANINGFUL = JSON.stringify({
  task: { ids: ['t1'], entities: { t1: { id: 't1', title: 'A task' } } },
});
const MEANINGFUL_2 = JSON.stringify({
  task: { ids: ['t2'], entities: { t2: { id: 't2', title: 'Another task' } } },
});
// Default/initial state: no tasks, no notes, only structural empties.
const EMPTY_STATE = JSON.stringify({
  task: { ids: [], entities: {} },
  project: { ids: [], entities: {} },
  tag: { ids: [], entities: {} },
  note: { ids: [], entities: {} },
});

describe('backup-ring.util', () => {
  describe('isUsableBackupStr', () => {
    it('returns false for null / undefined / empty string', () => {
      expect(isUsableBackupStr(null)).toBe(false);
      expect(isUsableBackupStr(undefined)).toBe(false);
      expect(isUsableBackupStr('')).toBe(false);
    });

    it('returns false for non-JSON / corrupt content', () => {
      expect(isUsableBackupStr('{not json')).toBe(false);
      expect(isUsableBackupStr('null')).toBe(false);
      expect(isUsableBackupStr('"just a string"')).toBe(false);
    });

    it('returns false for a parseable but data-less (default) state', () => {
      expect(isUsableBackupStr(EMPTY_STATE)).toBe(false);
      expect(isUsableBackupStr('{}')).toBe(false);
    });

    it('returns true for a state containing user data', () => {
      expect(isUsableBackupStr(MEANINGFUL)).toBe(true);
    });
  });

  describe('selectBestBackupStr', () => {
    it('prefers a usable primary over the previous generation', () => {
      expect(selectBestBackupStr(MEANINGFUL, MEANINGFUL_2)).toBe(MEANINGFUL);
    });

    it('falls back to the previous generation when the primary is corrupt', () => {
      expect(selectBestBackupStr('{broken', MEANINGFUL_2)).toBe(MEANINGFUL_2);
    });

    it('falls back to the previous generation when the primary is empty state', () => {
      expect(selectBestBackupStr(EMPTY_STATE, MEANINGFUL_2)).toBe(MEANINGFUL_2);
    });

    it('returns the raw primary when neither slot is usable (caller handles it)', () => {
      expect(selectBestBackupStr(EMPTY_STATE, null)).toBe(EMPTY_STATE);
    });

    it('returns null when both slots are empty', () => {
      expect(selectBestBackupStr(null, undefined)).toBeNull();
      expect(selectBestBackupStr('', '')).toBeNull();
    });
  });
});
