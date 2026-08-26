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
  description_html?: string;
  priority?: string;
  target_date?: string | null;
  updated_at?: string;
  project?: string | PlaneProject;
  state?: string | PlaneState;
  /** Plane Cloud only (absent on self-hosted through v1.4.2); falls back to `state`. */
  state_group?: string;
  assignees?: Array<string | PlaneUser>;
  labels?: unknown[];
}

// `expand` only inflates keys that survive `fields`, so every LIST_EXPAND key must be
// listed here. Projecting drops `description_html`, which dominates an unprojected row.
export const LIST_FIELDS = [
  'id',
  'name',
  'sequence_id',
  'state',
  'target_date',
  'priority',
  'updated_at',
].join(',');

/** Expands `state` to `{ id, name, color, group }`. */
export const LIST_EXPAND = 'state';

// Must stay unique per project: Plane pages by OFFSET and the list endpoint sorts without
// a tiebreaker, so a repeated key lets a row land on two pages or none.
export const LIST_ORDER_BY = 'sequence_id';

/** Documented maximum; a lower cap on an older self-hosted instance would 400. */
export const LIST_PAGE_SIZE = 100;

/** Bound on one listing pass: LIST_PAGE_SIZE × this. */
export const LIST_MAX_PAGES = 20;

/**
 * Validated base for a self-hosted instance, or `''` for Plane Cloud. A bare hostname
 * would make every request relative and send `X-API-Key` to the app's own origin; a
 * trailing path is kept, since reverse-proxied instances live under one.
 */
export const normalizeHost = (rawHost: string | undefined): string => {
  const host = (rawHost || '').trim().replace(/\/+$/, '');
  if (!host) {
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(host);
  } catch {
    throw new Error(
      'Plane host must be a full URL including the scheme, e.g. https://plane.example.com',
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Plane host must use http or https, not ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      'Plane host must not embed credentials. Use the API key field instead.',
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Plane host must not contain a query string or fragment.');
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
};

/** API origin: configured host, or Plane Cloud. */
export const getApiBase = (cfg: PlaneConfig): string =>
  normalizeHost(cfg.host) || CLOUD_API_BASE;

/**
 * UI origin for browse links. A self-hosted instance serves its API and its web app
 * from the same origin; Plane Cloud splits them across `api.` and `app.`.
 */
export const getUiBase = (cfg: PlaneConfig): string =>
  normalizeHost(cfg.host) || CLOUD_UI_BASE;

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

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

/**
 * Plain text from a work item's HTML description. Self-hosted Plane never sends
 * `description_stripped` (`IssueSerializer.Meta` excludes it), so without this the
 * description is blank on every open-source instance.
 */
export const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const key = entity.toLowerCase();
      if (key.startsWith('#x')) {
        return String.fromCodePoint(parseInt(key.slice(2), 16));
      }
      if (key.startsWith('#')) {
        return String.fromCodePoint(Number(key.slice(1)));
      }
      return HTML_ENTITIES[key] ?? match;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Plane serializes `target_date` / `start_date` as a bare calendar date. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const localDayStr = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/**
 * A work item's target date at **local** midnight in ms, or `null`.
 *
 * `target_date` is a `DateField` — a calendar day with no time. `new Date('2026-08-03')`
 * would read it as midnight UTC, which is still 2 August anywhere west of Greenwich.
 *
 * Never returns `NaN`: the host accepts `start` on a bare `typeof === 'number'` check, so
 * a leaked `NaN` is persisted as a due day of `"NaN-NaN-NaN"`. The three guards overlap
 * but none is dead — the round-trip alone accepts that literal string, since it is what
 * an invalid date formats back to.
 */
export const targetDateToLocalMs = (value: string | null | undefined): number | null => {
  if (!value || !DATE_ONLY_RE.test(value)) {
    return null;
  }
  const ms = new Date(`${value}T00:00:00`).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  // JS rolls impossible dates forward — `2026-02-30` becomes 2 March. Round-tripping
  // rejects those instead of silently scheduling the task on a day nobody chose.
  return localDayStr(new Date(ms)) === value ? ms : null;
};

export const stateOf = (item: PlaneWorkItem): PlaneState | null => {
  if (item.state && typeof item.state === 'object') {
    return item.state;
  }
  return null;
};

/**
 * Group of a work item's state, from whichever shape the response used: the
 * denormalized `state_group` (present under a `fields` projection) or the expanded
 * `state` object.
 */
export const stateGroupOf = (item: PlaneWorkItem): string =>
  item.state_group || stateOf(item)?.group || '';

/** An item counts as open unless Plane says its state group is finished. A missing group
 * is treated as open: showing one already-done task costs the user a click, while hiding a
 * real one costs them the work. */
export const isOpenWorkItem = (item: PlaneWorkItem): boolean =>
  !isDoneStateGroup(stateGroupOf(item));

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
  const dueMs = targetDateToLocalMs(item.target_date);
  return {
    id: item.id,
    title: item.name,
    body: item.description_stripped || htmlToText(item.description_html || ''),
    url: buildBrowseUrl(cfg, ident, item.sequence_id),
    // Only the expanded object carries a name; an unexpanded `state` is a bare UUID
    // and showing that to the user is worse than showing nothing.
    state: state?.name || '',
    lastUpdated: item.updated_at ? new Date(item.updated_at).getTime() : 0,
    assignee: assignees[0],
    summary: `${key} ${item.name}`,
    identifier: key,
    sequenceId: item.sequence_id,
    projectIdentifier: ident,
    stateGroup: stateGroupOf(item),
    priority: item.priority || '',
    due: item.target_date || '',
    // `start` is how the host seeds a date-only due day (it derives `dueDay` from it);
    // `dueWithTime` would claim a precision `target_date` does not have.
    ...(dueMs !== null ? { start: dueMs } : {}),
    assignees,
  };
};

export const mapListRow = (
  item: PlaneWorkItem,
  cfg: PlaneConfig,
  projectIdentifier: string,
): PluginSearchResult => {
  const key = displayKey(projectIdentifier, item.sequence_id);
  const dueMs = targetDateToLocalMs(item.target_date);
  return {
    id: item.id,
    title: `${key} ${item.name}`,
    url: buildBrowseUrl(cfg, projectIdentifier, item.sequence_id),
    // Only the expanded object carries a name; a bare UUID is worse than nothing.
    status: stateOf(item)?.name || '',
    summary: `${key} ${item.name}`,
    identifier: key,
    stateGroup: stateGroupOf(item),
    ...(item.target_date ? { due: item.target_date } : {}),
    ...(dueMs !== null ? { start: dueMs } : {}),
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

/**
 * Project-scoped API root. Both segments are user-entered — a pasted project URL
 * instead of a bare UUID must not be able to reshape the path.
 */
export const projectRoot = (cfg: PlaneConfig): string =>
  `${apiRoot(cfg)}/projects/${encodeURIComponent((cfg.projectId || '').trim())}`;
