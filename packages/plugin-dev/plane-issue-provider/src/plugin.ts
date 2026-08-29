import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';
import {
  apiRoot,
  isDoneStateGroup,
  isOpenWorkItem,
  LIST_EXPAND,
  LIST_FIELDS,
  LIST_MAX_PAGES,
  LIST_ORDER_BY,
  LIST_PAGE_SIZE,
  mapListRow,
  mapSearchHit,
  mapWorkItem,
  PlaneConfig,
  PlaneProject,
  PlaneSearchHit,
  PlaneWorkItem,
  projectRoot,
} from './plane-helpers';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

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
  const project = await http.get<PlaneProject>(`${projectRoot(cfg)}/`);
  return project?.identifier || '';
};

/**
 * Every open work item in the configured project. Plane's public API has no state filter
 * (the endpoint that takes one is Plane Cloud only), so the filtering happens here.
 */
const listOpenWorkItems = async (
  cfg: PlaneConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const projectIdentifier = await fetchProjectIdentifier(cfg, http);

  const out: PluginSearchResult[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const params: Record<string, string> = {
      per_page: String(LIST_PAGE_SIZE),
      order_by: LIST_ORDER_BY,
      fields: LIST_FIELDS,
      expand: LIST_EXPAND,
    };
    if (cursor) {
      params['cursor'] = cursor;
    }
    const res = await http.get<PlaneListResponse>(`${projectRoot(cfg)}/work-items/`, {
      params,
    });

    for (const item of res?.results || []) {
      if (isOpenWorkItem(item)) {
        out.push(mapListRow(item, cfg, projectIdentifier));
      }
    }
    if (!res?.next_page_results || !res.next_cursor) {
      return out;
    }
    cursor = res.next_cursor;
  }

  console.warn(
    `[plane-issue-provider] project has more than ${LIST_MAX_PAGES * LIST_PAGE_SIZE} ` +
      `work items; imported the first ${out.length} open ones`,
  );
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
      // Plane labels the short identifier (e.g. `ACME`) "Project ID" in its own
      // settings, so reusing that name here sends people to the wrong value.
      label: t('CFG.PROJECT_ID', 'Project UUID'),
      required: true,
      description: t(
        'CFG.PROJECT_ID_HELP',
        'The long id after /projects/ in the project URL: ' +
          'app.plane.so/<workspace-slug>/projects/<project-uuid>/',
      ),
    },
    {
      key: 'host',
      type: 'input',
      label: t('CFG.HOST', 'Host (self-hosted only; leave empty for Plane Cloud)'),
      description: t(
        'CFG.HOST_HELP',
        'Full origin including https://, e.g. https://plane.example.com',
      ),
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
      `${projectRoot(cfg)}/work-items/${encodeURIComponent(issueId)}/`,
      { params: { expand: 'state,assignees,project' } },
    );
    return mapWorkItem(item, cfg);
  },

  // Browse URLs need project identifier + sequence; fall back to getById().url.
  getIssueLink(): string {
    return '';
  },

  // Probing the project validates all three fields; `/users/me/` would pass with a
  // wrong slug or project and then import nothing.
  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = asConfig(config);
    try {
      const project = await http.get<PlaneProject>(`${projectRoot(cfg)}/`);
      return !!project?.id;
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
      // `description_stripped` is plain text, not markdown.
      field: 'body',
      label: t('DISPLAY.DESCRIPTION', 'Description'),
      type: 'text',
      hideEmpty: true,
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
