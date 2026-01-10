import {
  getEffectiveCheckInterval,
  LOCAL_FILE_CHECK_INTERVAL,
  DEFAULT_CALENDAR_CFG,
} from './calendar.const';
import { IssueProviderCalendar } from '../../issue.model';

describe('calendar.const', () => {
  describe('LOCAL_FILE_CHECK_INTERVAL', () => {
    it('should be 5 minutes in milliseconds', () => {
      expect(LOCAL_FILE_CHECK_INTERVAL).toBe(5 * 60 * 1000);
    });
  });

  describe('getEffectiveCheckInterval', () => {
    const createMockProvider = (
      overrides: Partial<IssueProviderCalendar> = {},
    ): IssueProviderCalendar =>
      ({
        id: 'test-provider',
        isEnabled: true,
        issueProviderKey: 'ICAL',
        icalUrl: 'https://example.com/calendar.ics',
        checkUpdatesEvery: DEFAULT_CALENDAR_CFG.checkUpdatesEvery,
        showBannerBeforeThreshold: DEFAULT_CALENDAR_CFG.showBannerBeforeThreshold,
        isAutoImportForCurrentDay: false,
        isDisabledForWebApp: false,
        ...overrides,
      }) as IssueProviderCalendar;

    it('should return LOCAL_FILE_CHECK_INTERVAL for file:// URLs', () => {
      const provider = createMockProvider({
        icalUrl: 'file:///home/user/calendar.ics',
      });

      expect(getEffectiveCheckInterval(provider)).toBe(LOCAL_FILE_CHECK_INTERVAL);
    });

    it('should return LOCAL_FILE_CHECK_INTERVAL for file:// URLs with different paths', () => {
      const provider = createMockProvider({
        icalUrl: 'file:///C:/Users/test/calendar.ics',
      });

      expect(getEffectiveCheckInterval(provider)).toBe(LOCAL_FILE_CHECK_INTERVAL);
    });

    it('should return checkUpdatesEvery for http:// URLs', () => {
      const customInterval = 30 * 60 * 1000; // 30 minutes
      const provider = createMockProvider({
        icalUrl: 'http://example.com/calendar.ics',
        checkUpdatesEvery: customInterval,
      });

      expect(getEffectiveCheckInterval(provider)).toBe(customInterval);
    });

    it('should return checkUpdatesEvery for https:// URLs', () => {
      const customInterval = 60 * 60 * 1000; // 1 hour
      const provider = createMockProvider({
        icalUrl: 'https://calendar.google.com/calendar.ics',
        checkUpdatesEvery: customInterval,
      });

      expect(getEffectiveCheckInterval(provider)).toBe(customInterval);
    });

    it('should return default checkUpdatesEvery when no custom interval set', () => {
      const provider = createMockProvider({
        icalUrl: 'https://example.com/calendar.ics',
      });

      expect(getEffectiveCheckInterval(provider)).toBe(
        DEFAULT_CALENDAR_CFG.checkUpdatesEvery,
      );
    });

    it('should handle undefined icalUrl gracefully', () => {
      const provider = createMockProvider({
        icalUrl: undefined as unknown as string,
      });

      expect(getEffectiveCheckInterval(provider)).toBe(
        DEFAULT_CALENDAR_CFG.checkUpdatesEvery,
      );
    });

    it('should handle empty string icalUrl', () => {
      const provider = createMockProvider({
        icalUrl: '',
      });

      expect(getEffectiveCheckInterval(provider)).toBe(
        DEFAULT_CALENDAR_CFG.checkUpdatesEvery,
      );
    });

    it('should be case-sensitive for file:// protocol', () => {
      // file:// should be lowercase per URI spec
      const provider = createMockProvider({
        icalUrl: 'FILE:///home/user/calendar.ics',
      });

      // FILE:// doesn't match file://, so should use default interval
      expect(getEffectiveCheckInterval(provider)).toBe(
        DEFAULT_CALENDAR_CFG.checkUpdatesEvery,
      );
    });
  });
});
