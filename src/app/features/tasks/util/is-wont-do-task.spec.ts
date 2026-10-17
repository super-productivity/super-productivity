import { getNextIsWontDo, isCompletedTask, isWontDoTask } from './is-wont-do-task';

describe('is-wont-do-task', () => {
  describe('isWontDoTask', () => {
    it('is true only for a done task marked as wont do', () => {
      expect(isWontDoTask({ isDone: true, isWontDo: true })).toBe(true);
      expect(isWontDoTask({ isDone: true })).toBe(false);
    });

    // A stale flag left on a reopened task must not count.
    it('ignores the flag on a task that is not done', () => {
      expect(isWontDoTask({ isDone: false, isWontDo: true })).toBe(false);
    });
  });

  describe('isCompletedTask', () => {
    it('excludes wont do tasks', () => {
      expect(isCompletedTask({ isDone: true })).toBe(true);
      expect(isCompletedTask({ isDone: true, isWontDo: true })).toBe(false);
      expect(isCompletedTask({ isDone: false })).toBe(false);
    });
  });

  describe('getNextIsWontDo', () => {
    const WONT_DO = { isDone: true, isWontDo: true };

    it('sets the flag when a task is finished as wont do', () => {
      expect(getNextIsWontDo({ isDone: false }, { isDone: true, isWontDo: true })).toBe(
        true,
      );
    });

    it('leaves the flag unset when a task is finished normally', () => {
      expect(getNextIsWontDo({ isDone: false }, { isDone: true })).toBe(false);
    });

    it('clears the flag when a task is un-done', () => {
      expect(getNextIsWontDo(WONT_DO, { isDone: false })).toBe(false);
    });

    it('clears the flag even if the un-doing update restates it', () => {
      expect(getNextIsWontDo(WONT_DO, { isDone: false, isWontDo: true })).toBe(false);
    });

    // e.g. auto-mark-parent-done or an issue-sync refresh writing `isDone` again
    it('keeps the flag when an already done task is marked done again', () => {
      expect(getNextIsWontDo(WONT_DO, { isDone: true })).toBe(true);
    });

    it('keeps the flag for an update that does not touch isDone', () => {
      expect(getNextIsWontDo(WONT_DO, {})).toBe(true);
    });

    it('does not set the flag on a task that is not done', () => {
      expect(getNextIsWontDo({ isDone: false }, { isWontDo: true })).toBe(false);
    });

    // `undefined` doesn't survive the op's JSON round-trip, so receivers never see it.
    it('treats an undefined flag in the update as absent', () => {
      expect(getNextIsWontDo(WONT_DO, { isDone: true, isWontDo: undefined })).toBe(true);
    });

    // A stale flag on an undone task must not survive finishing it normally.
    it('does not revive a stale flag when a task is finished normally', () => {
      expect(getNextIsWontDo({ isDone: false, isWontDo: true }, { isDone: true })).toBe(
        false,
      );
    });
  });
});
