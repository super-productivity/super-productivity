import type { PluginIssue, PluginSearchResult } from '@super-productivity/plugin-api';

export const CLOUD_API_BASE = 'https://api.plane.so';
export const CLOUD_UI_BASE = 'https://app.plane.so';
export const DONE_STATE_GROUPS = ['completed', 'cancelled'];

export interface PlaneConfig {
  apiKey?: string;
  host?: string;
  workspaceSlug?: string;
  projectId?: string;
}

export interface PlaneState {
  id?: string;
  name?: string;
  group?: string;
}

export interface PlaneUser {
  id?: string;
  display_name?: string;
  first_name?: string;
  email?: string;
}

export interface PlaneProject {
  id?: string;
  identifier?: string;
  name?: string;
}

export interface PlaneSearchHit {
  id: string;
  name: string;
  sequence_id: number;
  project__identifier?: string;
  project_id?: string;
  workspace__slug?: string;
}

export interface PlaneWorkItem {
  id: string;
  name: string;
  sequence_id: number;
  description_stripped?: string;
  priority?: string;
  target_date?: string | null;
  updated_at?: string;
  project?: string | PlaneProject;
  state?: string | PlaneState;
  assignees?: Array<string | PlaneUser>;
  labels?: unknown[];
}

/** API origin: configured host, or Plane Cloud. */
export const getApiBase = (cfg: PlaneConfig): string => {
  const host = (cfg.host || '').trim().replace(/\/+$/, '');
  return host || CLOUD_API_BASE;
};

/** UI origin for browse links. */
export const getUiBase = (cfg: PlaneConfig): string => {
  const host = (cfg.host || '').trim().replace(/\/+$/, '');
  return host || CLOUD_UI_BASE;
};

export const buildBrowseUrl = (
  cfg: PlaneConfig,
  projectIdentifier: string,
  sequenceId: number,
): string => {
  const slug = (cfg.workspaceSlug || '').trim();
  if (!slug || !projectIdentifier || !sequenceId) {
    return '';
  }
  return `${getUiBase(cfg)}/${slug}/browse/${projectIdentifier}-${sequenceId}`;
};

export const displayKey = (projectIdentifier: string, sequenceId: number): string =>
  `${projectIdentifier}-${sequenceId}`;

export const isDoneStateGroup = (group: unknown): boolean =>
  typeof group === 'string' && DONE_STATE_GROUPS.includes(group);

export const stateOf = (item: PlaneWorkItem): PlaneState | null => {
  if (item.state && typeof item.state === 'object') {
    return item.state;
  }
  return null;
};

export const projectIdentifierOf = (item: PlaneWorkItem, fallback = ''): string => {
  if (item.project && typeof item.project === 'object' && item.project.identifier) {
    return item.project.identifier;
  }
  return fallback;
};

export const assigneeNames = (item: PlaneWorkItem): string[] =>
  (item.assignees || [])
    .map((a) => {
      if (typeof a === 'string') {
        return '';
      }
      return a.display_name || a.first_name || a.email || '';
    })
    .filter((name): name is string => !!name);

export const mapSearchHit = (
  hit: PlaneSearchHit,
  cfg: PlaneConfig,
): PluginSearchResult => {
  const ident = hit.project__identifier || '';
  const key = displayKey(ident, hit.sequence_id);
  return {
    id: hit.id,
    title: `${key} ${hit.name}`,
    url: buildBrowseUrl(cfg, ident, hit.sequence_id),
    summary: `${key} ${hit.name}`,
    identifier: key,
    sequenceId: hit.sequence_id,
    projectIdentifier: ident,
  };
};

export const mapWorkItem = (
  item: PlaneWorkItem,
  cfg: PlaneConfig,
  projectIdentifierFallback = '',
): PluginIssue => {
  const state = stateOf(item);
  const ident = projectIdentifierOf(item, projectIdentifierFallback);
  const key = displayKey(ident, item.sequence_id);
  const assignees = assigneeNames(item);
  return {
    id: item.id,
    title: item.name,
    body: item.description_stripped || '',
    url: buildBrowseUrl(cfg, ident, item.sequence_id),
    state: state?.name || (typeof item.state === 'string' ? item.state : ''),
    lastUpdated: item.updated_at ? new Date(item.updated_at).getTime() : 0,
    assignee: assignees[0],
    summary: `${key} ${item.name}`,
    identifier: key,
    sequenceId: item.sequence_id,
    projectIdentifier: ident,
    stateGroup: state?.group || '',
    priority: item.priority || '',
    due: item.target_date || '',
    assignees,
  };
};

export const mapWorkItemSearchResult = (
  item: PlaneWorkItem,
  cfg: PlaneConfig,
  projectIdentifierFallback = '',
): PluginSearchResult => {
  const mapped = mapWorkItem(item, cfg, projectIdentifierFallback);
  return {
    id: mapped.id,
    title: String(mapped.summary || mapped.title),
    url: mapped.url,
    status: mapped.state,
    assignee: mapped.assignee,
    summary: mapped.summary,
    identifier: mapped.identifier,
    stateGroup: mapped.stateGroup,
    ...(mapped.due ? { due: mapped.due } : {}),
  };
};

export const apiRoot = (cfg: PlaneConfig): string => {
  const slug = (cfg.workspaceSlug || '').trim();
  if (!slug) {
    throw new Error('Plane workspace slug is not configured.');
  }
  if (!(cfg.projectId || '').trim()) {
    throw new Error('Plane project ID is not configured.');
  }
  return `${getApiBase(cfg)}/api/v1/workspaces/${encodeURIComponent(slug)}`;
};
