import {
  IssueProvider,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../issue.model';

const _hueFromId = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    const shifted = h * 31;
    h = (shifted + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
};

export const getCalendarProviderColor = (p: IssueProvider): string => {
  if ('color' in p && typeof p.color === 'string' && p.color) return p.color;
  if (isPluginIssueProvider(p.issueProviderKey)) {
    const c = (p as IssueProviderPluginType).pluginConfig?.['color'];
    if (typeof c === 'string' && c) return c;
  }
  return `hsl(${_hueFromId(p.id)}, 60%, 55%)`;
};
