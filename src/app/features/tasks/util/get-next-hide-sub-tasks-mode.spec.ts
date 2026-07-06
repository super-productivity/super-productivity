import { getNextHideSubTasksMode } from './get-next-hide-sub-tasks-mode';
import { HideSubTasksMode } from '../task.model';

const { HideDone, HideAll } = HideSubTasksMode;

describe('getNextHideSubTasksMode', () => {
  describe('with a mix of done and undone subtasks (HideDone step is available)', () => {
    // 3 subtasks, 1 done → isDoneTaskCaseNeeded
    const next = (
      cur: HideSubTasksMode | undefined,
      isShowLess: boolean,
      isEndless = false,
    ): HideSubTasksMode | undefined =>
      getNextHideSubTasksMode(cur, 1, 3, isShowLess, isEndless);

    it('shows-less stepping: show → HideDone → HideAll (then clamps)', () => {
      expect(next(undefined, true)).toBe(HideDone);
      expect(next(HideDone, true)).toBe(HideAll);
      expect(next(HideAll, true)).toBe(HideAll);
    });

    it('shows-more stepping: HideAll → HideDone → show (then clamps)', () => {
      expect(next(HideAll, false)).toBe(HideDone);
      expect(next(HideDone, false)).toBeUndefined();
      expect(next(undefined, false)).toBeUndefined();
    });
  });

  describe('without a mix (no done, or all done) — HideDone step is skipped', () => {
    // 3 subtasks, 0 done → not isDoneTaskCaseNeeded
    const next = (
      cur: HideSubTasksMode | undefined,
      isShowLess: boolean,
      isEndless = false,
    ): HideSubTasksMode | undefined =>
      getNextHideSubTasksMode(cur, 0, 3, isShowLess, isEndless);

    it('shows-less jumps straight from show to HideAll (skipping HideDone)', () => {
      expect(next(undefined, true)).toBe(HideAll);
    });

    it('shows-more jumps straight from HideAll to show (skipping HideDone)', () => {
      expect(next(HideAll, false)).toBeUndefined();
    });

    it('treats all-done the same as none-done (no HideDone step)', () => {
      expect(getNextHideSubTasksMode(undefined, 3, 3, true, false)).toBe(HideAll);
    });
  });

  describe('endless wrap-around', () => {
    const next = (
      cur: HideSubTasksMode | undefined,
      isShowLess: boolean,
    ): HideSubTasksMode | undefined =>
      getNextHideSubTasksMode(cur, 0, 3, isShowLess, true);

    it('wraps HideAll → show when stepping past the hide end', () => {
      expect(next(HideAll, true)).toBeUndefined();
    });

    it('wraps show → HideAll when stepping past the show end', () => {
      expect(next(undefined, false)).toBe(HideAll);
    });
  });

  it('returns undefined (not 0) when clearing collapse state', () => {
    // decrement from HideAll with no mix clears back to fully-shown
    expect(getNextHideSubTasksMode(HideAll, 0, 3, false, false)).toBeUndefined();
  });

  it('handles a task with no subtasks without stepping into HideDone', () => {
    expect(getNextHideSubTasksMode(undefined, 0, 0, true, false)).toBe(HideAll);
  });
});
