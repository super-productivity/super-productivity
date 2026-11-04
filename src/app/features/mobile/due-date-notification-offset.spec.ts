import { LS } from '../../core/persistence/storage-keys.const';
import {
  DUE_DATE_NOTIFICATION_MAX_OFFSET_MS,
  getDueDateNotificationOffsetMs,
} from './due-date-notification-offset';

describe('getDueDateNotificationOffsetMs', () => {
  beforeEach(() => localStorage.removeItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS));
  afterEach(() => localStorage.removeItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS));

  it('picks an offset within the window on first use', () => {
    const offset = getDueDateNotificationOffsetMs();

    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(DUE_DATE_NOTIFICATION_MAX_OFFSET_MS);
  });

  it('keeps the same offset across calls so one install stays on one time', () => {
    const first = getDueDateNotificationOffsetMs();

    expect(getDueDateNotificationOffsetMs()).toBe(first);
  });

  it('reuses a stored offset', () => {
    localStorage.setItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS, '123000');

    expect(getDueDateNotificationOffsetMs()).toBe(123000);
  });

  it('replaces a stored value outside the window', () => {
    localStorage.setItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS, 'garbage');
    const offset = getDueDateNotificationOffsetMs();

    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(DUE_DATE_NOTIFICATION_MAX_OFFSET_MS);
    expect(localStorage.getItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS)).toBe(String(offset));
  });

  ['-1', String(DUE_DATE_NOTIFICATION_MAX_OFFSET_MS + 1), '1.5'].forEach((stored) => {
    it(`replaces the out-of-range number ${stored}`, () => {
      localStorage.setItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS, stored);
      const offset = getDueDateNotificationOffsetMs();

      expect(String(offset)).not.toBe(stored);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(DUE_DATE_NOTIFICATION_MAX_OFFSET_MS);
    });
  });
});
