import { isCalendarProviderDisabledOnCurrentPlatform } from './is-calendar-provider-disabled-on-current-platform.util';
import { IssueProviderCalendar } from '../../issue.model';

const createCalendarProvider = (
  overrides: Partial<IssueProviderCalendar> = {},
): Pick<IssueProviderCalendar, 'isDisabledForWebApp'> => ({
  isDisabledForWebApp: false,
  ...overrides,
});

describe('isCalendarProviderDisabledOnCurrentPlatform', () => {
  it('returns false when the provider disable flag is off', () => {
    const provider = createCalendarProvider({ isDisabledForWebApp: false });

    expect(isCalendarProviderDisabledOnCurrentPlatform(provider, true, true)).toBe(false);
  });

  it('returns true for browsers when the provider disable flag is on', () => {
    const provider = createCalendarProvider({ isDisabledForWebApp: true });

    expect(isCalendarProviderDisabledOnCurrentPlatform(provider, true, false)).toBe(true);
  });

  it('returns true for Android when the provider disable flag is on', () => {
    const provider = createCalendarProvider({ isDisabledForWebApp: true });

    expect(isCalendarProviderDisabledOnCurrentPlatform(provider, false, true)).toBe(true);
  });

  it('returns false for desktop when the provider disable flag is on', () => {
    const provider = createCalendarProvider({ isDisabledForWebApp: true });

    expect(isCalendarProviderDisabledOnCurrentPlatform(provider, false, false)).toBe(
      false,
    );
  });
});
