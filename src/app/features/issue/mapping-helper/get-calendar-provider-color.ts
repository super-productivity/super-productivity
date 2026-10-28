import {
  IssueProvider,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../issue.model';

// Provider colors end up in a `[style.background]` binding. Only accept plain
// color literals so a plugin config can't smuggle in `url(...)` and turn every
// render into an outbound request.
const SAFE_CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\)|[a-z]+)$/i;

const _hueFromId = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    const shifted = h * 31;
    h = (shifted + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
};

const _explicitColor = (p: IssueProvider): unknown =>
  'color' in p && p.color
    ? p.color
    : isPluginIssueProvider(p.issueProviderKey)
      ? (p as IssueProviderPluginType).pluginConfig?.['color']
      : undefined;

const _isSafeColor = (c: unknown): c is string =>
  typeof c === 'string' && SAFE_CSS_COLOR.test(c);

/**
 * The color the user set on the provider, else the color the calendar source
 * reported for the event's calendar (e.g. a Google calendar's color), else a
 * stable color derived from the provider id.
 */
export const getCalendarProviderColor = (
  p: IssueProvider,
  calendarColor?: unknown,
): string => {
  const c = _explicitColor(p);
  if (_isSafeColor(c)) return c;
  if (_isSafeColor(calendarColor)) return calendarColor;
  return `hsl(${_hueFromId(p.id)}, 60%, 55%)`;
};
