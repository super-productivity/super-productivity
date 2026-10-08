import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
  PluginTimeEntry,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

/* eslint-disable @typescript-eslint/naming-convention */

const LIMIT = '100';
const MS_PER_HOUR = 3600000;
const ISSUE_ID_QUERY_RGX = /^#?(\d+)$/;

type RedmineScope = 'all' | 'created-by-me' | 'assigned-to-me';

interface RedmineConfig {
  host?: string;
  api_key?: string;
  projectId?: string;
  scope?: RedmineScope;
}

interface RedmineNamed {
  id: number;
  name: string;
}

interface RedmineIssue {
  id: number;
  subject: string;
  description?: string;
  status?: RedmineNamed;
  priority?: RedmineNamed;
  author?: RedmineNamed;
  assigned_to?: RedmineNamed;
  category?: RedmineNamed;
  fixed_version?: RedmineNamed;
  due_date?: string;
  spent_hours?: number;
  updated_on?: string;
}

interface RedmineSearchItem {
  id: number;
  // Redmine formats this as e.g. "Bug #12 (New): subject"
  title: string;
  url: string;
  datetime?: string;
}

const t = (key: string, params?: Record<string, string | number>): string => {
  try {
    return PluginAPI.translate(key, params);
  } catch {
    return key;
  }
};

const asCfg = (config: Record<string, unknown>): RedmineConfig =>
  config as unknown as RedmineConfig;

const getHost = (cfg: RedmineConfig): string => (cfg.host || '').replace(/\/$/, '');

// Empty when no project is set: requests then hit the instance-wide endpoints,
// so one connection can search the whole Redmine instead of a single project.
const projectScope = (cfg: RedmineConfig): string =>
  cfg.projectId ? `/projects/${cfg.projectId}` : '';

const toMs = (date: string | undefined): number => (date ? new Date(date).getTime() : 0);

const issueUrl = (cfg: RedmineConfig, id: number | string): string =>
  `${getHost(cfg)}/issues/${id}`;

const formatSpentHours = (spentHours: number | undefined): string => {
  if (!spentHours || spentHours <= 0) {
    return '';
  }
  const hours = Math.floor(spentHours);
  const minutes = Math.round((spentHours - hours) * 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

// `status` (not `state`) on purpose: the host derives isDone from `state`, and
// the built-in provider never synced the done state from Redmine.
const mapIssue = (issue: RedmineIssue, cfg: RedmineConfig): PluginIssue => ({
  id: String(issue.id),
  title: `#${issue.id} ${issue.subject}`,
  body: issue.description || '',
  url: issueUrl(cfg, issue.id),
  lastUpdated: toMs(issue.updated_on),
  assignee: issue.assigned_to?.name,
  status: issue.status?.name || '',
  priority: issue.priority?.name || '',
  author: issue.author?.name || '',
  category: issue.category?.name || '',
  version: issue.fixed_version?.name || '',
  dueDate: issue.due_date || '',
  timeSpent: formatSpentHours(issue.spent_hours),
});

const mapSearchItem = (item: RedmineSearchItem): PluginSearchResult => ({
  id: String(item.id),
  title: `#${item.id} ${item.title.split(`#${item.id}`).join('').trim()}`,
  url: item.url,
  lastUpdated: toMs(item.datetime),
});

const fetchIssues = async (
  cfg: RedmineConfig,
  http: PluginHttp,
  params: Record<string, string>,
): Promise<RedmineIssue[]> => {
  const res = await http.get<{ issues?: RedmineIssue[] }>(
    `${getHost(cfg)}${projectScope(cfg)}/issues.json`,
    { params },
  );
  return res?.issues || [];
};

const hasNonAscii = (query: string): boolean => /[^\u0000-\u007F]/.test(query);

const mergeById = (...groups: PluginSearchResult[][]): PluginSearchResult[] => {
  const seen = new Set<string>();
  return groups.flat().filter((r) => !seen.has(r.id) && !!seen.add(r.id));
};

const scopeParams = (cfg: RedmineConfig): Record<string, string> => {
  // Default matches the built-in provider ('assigned-to-me'); the plugin form
  // has no default-value mechanism for selects.
  const scope: RedmineScope = cfg.scope || 'assigned-to-me';
  if (scope === 'created-by-me') {
    return { author_id: 'me' };
  }
  if (scope === 'assigned-to-me') {
    return { assigned_to_id: 'me' };
  }
  return {};
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'host',
      type: 'input',
      label: t('CFG.HOST'),
      required: true,
      pattern: '^.+\\/.+?$',
    },
    { key: 'api_key', type: 'password', label: t('CFG.API_KEY'), required: true },
    {
      key: 'projectId',
      type: 'input',
      label: t('CFG.PROJECT_ID'),
      description: t('CFG.PROJECT_ID_DESC'),
    },
    {
      key: 'scope',
      type: 'select',
      label: t('CFG.SCOPE'),
      options: [
        { value: 'all', label: t('CFG.SCOPE_ALL') },
        { value: 'created-by-me', label: t('CFG.SCOPE_CREATED') },
        { value: 'assigned-to-me', label: t('CFG.SCOPE_ASSIGNED') },
      ],
    },
    // Well-known keys read by the host's track-time dialog (see `timeTracking`)
    {
      key: 'isShowTimeTrackingDialog',
      type: 'checkbox',
      label: t('CFG.IS_SHOW_TIME_TRACKING_DIALOG'),
      description: t('CFG.IS_SHOW_TIME_TRACKING_DIALOG_DESC'),
      advanced: true,
    },
    {
      key: 'isShowTimeTrackingDialogForEachSubTask',
      type: 'checkbox',
      label: t('CFG.IS_SHOW_TIME_TRACKING_DIALOG_FOR_EACH_SUB_TASK'),
      advanced: true,
      showIf: 'isShowTimeTrackingDialog',
    },
    {
      key: 'timeTrackingDialogDefaultTime',
      type: 'select',
      label: t('CFG.DEFAULT_TIME'),
      advanced: true,
      showIf: 'isShowTimeTrackingDialog',
      options: [
        { value: 'AllTime', label: t('CFG.DEFAULT_TIME_ALL_TIME') },
        {
          value: 'AllTimeMinusLogged',
          label: t('CFG.DEFAULT_TIME_ALL_TIME_MINUS_LOGGED'),
        },
        { value: 'TimeToday', label: t('CFG.DEFAULT_TIME_TODAY') },
        { value: 'TimeYesterday', label: t('CFG.DEFAULT_TIME_YESTERDAY') },
      ],
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    return {
      'X-Redmine-API-Key': asCfg(config).api_key || '',
      'Content-Type': 'application/json',
    };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asCfg(config);
    const query = searchTerm.trim();
    const idMatch = query.match(ISSUE_ID_QUERY_RGX);

    // `status_id=*` so a closed issue can still be found by its exact id
    const byIdPromise: Promise<PluginSearchResult[]> = idMatch
      ? fetchIssues(cfg, http, { issue_id: idMatch[1], status_id: '*', limit: '1' })
          .then((issues) => issues.map((i) => mapIssue(i, cfg) as PluginSearchResult))
          .catch(() => [])
      : Promise.resolve([]);

    const searchPromise = http
      .get<{
        results?: RedmineSearchItem[];
      }>(`${getHost(cfg)}${projectScope(cfg)}/search.json`, { params: { limit: LIMIT, q: query, issues: '1', open_issues: '1' } })
      .then((res) => (res?.results || []).map(mapSearchItem));

    const results = mergeById(...(await Promise.all([byIdPromise, searchPromise])));
    if (results.length || !query || !hasNonAscii(query)) {
      return results;
    }
    // Redmine's full-text search misses many non-ASCII (e.g. CJK) terms; fall
    // back to a subject "contains" filter.
    const bySubject = await fetchIssues(cfg, http, {
      set_filter: '1',
      'f[]': 'subject',
      'op[subject]': '~',
      'v[subject][]': query,
      status_id: 'open',
      limit: LIMIT,
    }).catch(() => []);
    return bySubject.map((i) => mapIssue(i, cfg) as PluginSearchResult);
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asCfg(config);
    const res = await http.get<{ issue: RedmineIssue }>(
      `${getHost(cfg)}/issues/${issueId}.json`,
    );
    return mapIssue(res.issue, cfg);
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    return issueUrl(asCfg(config), issueId);
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = asCfg(config);
    try {
      await http.get(`${getHost(cfg)}${projectScope(cfg)}/issues.json`, {
        params: { limit: '1' },
      });
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asCfg(config);
    const issues = await fetchIssues(cfg, http, { limit: LIMIT, ...scopeParams(cfg) });
    return issues.map((i) => mapIssue(i, cfg) as PluginSearchResult);
  },

  issueDisplay: [
    { field: 'title', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'status', label: t('DISPLAY.STATUS'), type: 'text', hideEmpty: true },
    { field: 'priority', label: t('DISPLAY.PRIORITY'), type: 'text', hideEmpty: true },
    { field: 'author', label: t('DISPLAY.AUTHOR'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'category', label: t('DISPLAY.CATEGORY'), type: 'text', hideEmpty: true },
    { field: 'version', label: t('DISPLAY.VERSION'), type: 'text', hideEmpty: true },
    { field: 'dueDate', label: t('DISPLAY.DUE_DATE'), type: 'text', hideEmpty: true },
    { field: 'timeSpent', label: t('DISPLAY.TIME_SPENT'), type: 'text', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown', hideEmpty: true },
  ],

  timeTracking: {
    async logTime(
      issueId: string,
      entry: PluginTimeEntry,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void> {
      await http.post(`${getHost(asCfg(config))}/time_entries.json`, {
        time_entry: {
          issue_id: Number(issueId),
          spent_on: toLocalDateStr(entry.started),
          hours: entry.timeSpentMs / MS_PER_HOUR,
          // Redmine's first default activity; the built-in provider used the same fallback
          activity_id: entry.activityId ?? 1,
          comments: entry.comment,
        },
      });
    },

    async getTimeLogged(
      issueId: string,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<number> {
      const res = await http.get<{ time_entries?: { hours: number }[] }>(
        `${getHost(asCfg(config))}/time_entries.json`,
        { params: { limit: LIMIT, issue_id: issueId, user_id: 'me' } },
      );
      const hours = (res?.time_entries || []).reduce((sum, e) => sum + e.hours, 0);
      return hours * MS_PER_HOUR;
    },

    async getActivities(
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<{ id: number; name: string }[]> {
      const res = await http.get<{ time_entry_activities?: RedmineNamed[] }>(
        `${getHost(asCfg(config))}/enumerations/time_entry_activities.json`,
      );
      return (res?.time_entry_activities || []).map(({ id, name }) => ({ id, name }));
    },
  },
} satisfies IssueProviderPluginDefinition as IssueProviderPluginDefinition);

// Redmine expects the local calendar day (YYYY-MM-DD) the work was done on
function toLocalDateStr(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
