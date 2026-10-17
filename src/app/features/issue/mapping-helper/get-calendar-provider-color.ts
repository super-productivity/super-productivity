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

export const getCalendarProviderColor = (p: IssueProvider): string => {
  const c = _explicitColor(p);
  if (typeof c === 'string' && SAFE_CSS_COLOR.test(c)) return c;
  return `hsl(${_hueFromId(p.id)}, 60%, 55%)`;
};
