import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';
import {
  apiRoot,
  getApiBase,
  isDoneStateGroup,
  mapSearchHit,
  mapWorkItem,
  mapWorkItemSearchResult,
  PlaneConfig,
  PlaneProject,
  PlaneSearchHit,
  PlaneWorkItem,
  stateOf,
} from './plane-helpers';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

const BACKLOG_PAGE_SIZE = 50;
const BACKLOG_MAX_PAGES = 2;

interface PlaneSearchResponse {
  issues?: PlaneSearchHit[];
}

interface PlaneListResponse {
  results?: PlaneWorkItem[];
  next_cursor?: string;
  next_page_results?: boolean;
}

const t = (key: string, fallback: string): string => {
  try {
    const translated = PluginAPI.translate(key);
    // Uploaded zips historically skipped i18n load; fall back so labels aren't raw keys.
    return !translated || translated === key ? fallback : translated;
  } catch {
    return fallback;
  }
};

const asConfig = (config: Record<string, unknown>): PlaneConfig =>
  config as unknown as PlaneConfig;

const fetchProjectIdentifier = async (
  cfg: PlaneConfig,
  http: PluginHttp,
): Promise<string> => {
  const project = await http.get<PlaneProject>(
    `${apiRoot(cfg)}/projects/${cfg.projectId}/`,
  );
  return project?.identifier || '';
};

const listOpenWorkItems = async (
  cfg: PlaneConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const projectIdentifier = await fetchProjectIdentifier(cfg, http);
  const out: PluginSearchResult[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < BACKLOG_MAX_PAGES; page++) {
    const params: Record<string, string> = {
      per_page: String(BACKLOG_PAGE_SIZE),
      expand: 'state,assignees,project',
    };
    if (cursor) {
      params['cursor'] = cursor;
    }
    const res = await http.get<PlaneListResponse>(
      `${apiRoot(cfg)}/projects/${cfg.projectId}/work-items/`,
      { params },
    );
    const results = res?.results || [];
    for (const item of results) {
      const state = stateOf(item);
      if (isDoneStateGroup(state?.group)) {
        continue;
      }
      out.push(mapWorkItemSearchResult(item, cfg, projectIdentifier));
    }
    if (!res?.next_page_results || !res.next_cursor) {
      break;
    }
    cursor = res.next_cursor;
  }
  return out;
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'apiKey',
      type: 'password',
      label: t('CFG.API_KEY', 'API Key'),
      required: true,
    },
    {
      key: 'apiKeyHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN', 'How to get an API key'),
      url: 'https://developers.plane.so/api-reference/introduction',
    },
    {
      key: 'workspaceSlug',
      type: 'input',
      label: t('CFG.WORKSPACE_SLUG', 'Workspace slug'),
      required: true,
      description: t(
        'CFG.WORKSPACE_SLUG_HELP',
        'From the URL: app.plane.so/<workspace-slug>/...',
      ),
    },
    {
      key: 'projectId',
      type: 'input',
      label: t('CFG.PROJECT_ID', 'Project ID (UUID)'),
      required: true,
      description: t(
        'CFG.PROJECT_ID_HELP',
        'Open the project in Plane; the UUID is in the project settings URL or API.',
      ),
    },
    {
      key: 'host',
      type: 'input',
      label: t('CFG.HOST', 'Host (self-hosted only; leave empty for Plane Cloud)'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = asConfig(config);
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'X-API-Key': cfg.apiKey || '',
      Accept: 'application/json',
    };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asConfig(config);
    const term = searchTerm.trim();
    if (!term) {
      return listOpenWorkItems(cfg, http);
    }
    const res = await http.get<PlaneSearchResponse>(
      `${apiRoot(cfg)}/work-items/search/`,
      {
        params: {
          search: term,
          limit: '50',
          project_id: (cfg.projectId || '').trim(),
        },
      },
    );
    return (res?.issues || []).map((hit) => mapSearchHit(hit, cfg));
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asConfig(config);
    const item = await http.get<PlaneWorkItem>(
      `${apiRoot(cfg)}/projects/${cfg.projectId}/work-items/${issueId}/`,
      { params: { expand: 'state,assignees,project,labels' } },
    );
    return mapWorkItem(item, cfg);
  },

  // Browse URLs need project identifier + sequence; fall back to getById().url.
  getIssueLink(): string {
    return '';
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = asConfig(config);
    try {
      await http.get(`${getApiBase(cfg)}/api/v1/users/me/`);
      return true;
    } catch {
      return false;
    }
  },

  getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return listOpenWorkItems(asConfig(config), http);
  },

  issueDisplay: [
    {
      field: 'summary',
      label: t('DISPLAY.SUMMARY', 'Summary'),
      type: 'link',
      linkField: 'url',
    },
    { field: 'state', label: t('DISPLAY.STATE', 'State'), type: 'text', hideEmpty: true },
    {
      field: 'priority',
      label: t('DISPLAY.PRIORITY', 'Priority'),
      type: 'text',
      hideEmpty: true,
    },
    {
      field: 'assignee',
      label: t('DISPLAY.ASSIGNEE', 'Assignee'),
      type: 'text',
      hideEmpty: true,
    },
    { field: 'due', label: t('DISPLAY.DUE', 'Due date'), type: 'date', hideEmpty: true },
    {
      field: 'body',
      label: t('DISPLAY.DESCRIPTION', 'Description'),
      type: 'markdown',
    },
  ],

  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'stateGroup',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string =>
        taskValue ? 'completed' : 'unstarted',
      toTaskValue: (issueValue: unknown): boolean => isDoneStateGroup(issueValue),
    },
  ] satisfies PluginFieldMapping[],

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      stateGroup: issue.stateGroup,
      title: issue.title,
      body: issue.body,
    };
  },
});
