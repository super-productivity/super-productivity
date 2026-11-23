import {
  getNativeTimeEstimate,
  isSameNativeTimeEstimate,
  isTimeEstimateNotifiedNatively,
} from './android-time-estimate.effects';
import { Task } from '../../tasks/task.model';

describe('android-time-estimate helpers', () => {
  const task = (patch: Partial<Task> = {}): Task =>
    ({ id: 't1', title: 'Write', timeEstimate: 60000, timeSpent: 0, ...patch }) as Task;

  describe('getNativeTimeEstimate', () => {
    it('returns the estimate of the current task when enabled', () => {
      expect(getNativeTimeEstimate(true, task())).toEqual({
        taskId: 't1',
        timeEstimate: 60000,
        title: 'Write',
      });
    });

    it('clears when the setting is off', () => {
      expect(getNativeTimeEstimate(false, task())).toBeNull();
    });

    it('clears when nothing is tracked', () => {
      expect(getNativeTimeEstimate(true, null)).toBeNull();
    });

    it('clears when the task has no estimate', () => {
      expect(getNativeTimeEstimate(true, task({ timeEstimate: 0 }))).toBeNull();
    });
  });

  describe('isSameNativeTimeEstimate', () => {
    const a = { taskId: 't1', timeEstimate: 60000, title: 'Write' };

    it('ignores timeSpent ticks (equal fields)', () => {
      expect(isSameNativeTimeEstimate(a, { ...a })).toBe(true);
    });

    it('detects a changed estimate, task or title', () => {
      expect(isSameNativeTimeEstimate(a, { ...a, timeEstimate: 1 })).toBe(false);
      expect(isSameNativeTimeEstimate(a, { ...a, taskId: 't2' })).toBe(false);
      expect(isSameNativeTimeEstimate(a, { ...a, title: 'x' })).toBe(false);
    });

    it('treats null and a value as different', () => {
      expect(isSameNativeTimeEstimate(null, null)).toBe(true);
      expect(isSameNativeTimeEstimate(null, a)).toBe(false);
      expect(isSameNativeTimeEstimate(a, null)).toBe(false);
    });
  });

  describe('isTimeEstimateNotifiedNatively', () => {
    it('is false outside the Android WebView', () => {
      expect(isTimeEstimateNotifiedNatively('t1')).toBe(false);
    });
  });
});
