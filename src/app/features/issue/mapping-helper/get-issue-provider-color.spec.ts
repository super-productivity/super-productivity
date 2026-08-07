import { getCalendarProviderColor } from './get-issue-provider-color';
import {
  IssueProvider,
  IssueProviderCalendar,
  IssueProviderPluginType,
} from '../issue.model';

const icalProvider = (over: Partial<IssueProviderCalendar> = {}): IssueProvider =>
  ({
    id: 'ical-1',
    isEnabled: true,
    issueProviderKey: 'ICAL',
    icalUrl: 'https://example.com/cal.ics',
    ...over,
  }) as IssueProvider;

const pluginProvider = (over: Partial<IssueProviderPluginType> = {}): IssueProvider =>
  ({
    id: 'plugin-1',
    isEnabled: true,
    issueProviderKey: 'plugin:caldav-calendar-provider',
    pluginId: 'caldav-calendar-provider',
    pluginConfig: {},
    ...over,
  }) as IssueProvider;

describe('getCalendarProviderColor', () => {
  it('returns the explicit color of an iCal provider', () => {
    expect(getCalendarProviderColor(icalProvider({ color: '#4caf50' }))).toBe('#4caf50');
  });

  it('returns the color from a plugin provider pluginConfig', () => {
    expect(
      getCalendarProviderColor(pluginProvider({ pluginConfig: { color: '#abcdef' } })),
    ).toBe('#abcdef');
  });

  it('falls back to a HSL color when an iCal provider has no color', () => {
    expect(getCalendarProviderColor(icalProvider())).toMatch(
      /^hsl\(\d{1,3}, 60%, 55%\)$/,
    );
  });

  it('falls back to a HSL color when a plugin provider has no color', () => {
    expect(getCalendarProviderColor(pluginProvider())).toMatch(
      /^hsl\(\d{1,3}, 60%, 55%\)$/,
    );
  });

  it('derives the fallback deterministically from the provider id', () => {
    const a = getCalendarProviderColor(pluginProvider({ id: 'same-id' }));
    const b = getCalendarProviderColor(pluginProvider({ id: 'same-id' }));
    expect(a).toBe(b);
  });

  it('gives different ids different fallback hues', () => {
    const a = getCalendarProviderColor(pluginProvider({ id: 'provider-aaa' }));
    const b = getCalendarProviderColor(pluginProvider({ id: 'provider-bbb' }));
    expect(a).not.toBe(b);
  });

  it('ignores an empty-string color and falls back', () => {
    expect(getCalendarProviderColor(icalProvider({ color: '' }))).toMatch(/^hsl\(/);
  });
});
