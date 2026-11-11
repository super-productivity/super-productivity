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
  parseWorkspaceUrl,
  PlaneConfig,
  PlaneProject,
  PlaneSearchHit,
  PlaneUserConfig,
  PlaneWorkItem,
  projectRoot,
  toProjectOptions,
  workspaceRoot,
} from './plane-helpers';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

interface PlaneSearchResponse {
  issues?: PlaneSearchHit[];
}

interface PlanePage<T> {
  results?: T[];
  next_cursor?: string;
  next_page_results?: boolean;
}

type PlaneListResponse = PlanePage<PlaneWorkItem>;

const t = (key: string, fallback: string): string => {
  try {
    const translated = PluginAPI.translate(key);
    // Uploaded zips historically skipped i18n load; fall back so labels aren't raw keys.
    return !translated || translated === key ? fallback : translated;
  } catch {
    return fallback;
  }
};

const asConfig = (config: Record<string, unknown>): PlaneConfig => {
  const raw = config as PlaneUserConfig;
  return {
    apiKey: raw.apiKey,
    projectId: raw.projectId,
    ...parseWorkspaceUrl(raw.workspaceUrl),
  };
};

/**
 * Every project the key can see in the workspace, for the project picker. Ordered by
 * `created_at` because Plane pages by offset and its default `sort_order` ties, which
 * can drop or repeat rows across pages.
 */
const loadProjectOptions = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const raw = config as PlaneUserConfig;
  const root = workspaceRoot(parseWorkspaceUrl(raw.workspaceUrl));
  const projects: PlaneProject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const params: Record<string, string> = {
      per_page: String(LIST_PAGE_SIZE),
      order_by: 'created_at',
      fields: 'id,name,identifier,archived_at',
    };
    if (cursor) {
      params['cursor'] = cursor;
    }
    const res = await http.get<PlanePage<PlaneProject>>(`${root}/projects/`, { params });
    projects.push(...(res?.results || []));
    if (!res?.next_page_results || !res.next_cursor) {
      break;
    }
    cursor = res.next_cursor;
  }
  return toProjectOptions(projects);
};

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
      // One pasted address carries the instance and the workspace, so Plane Cloud and
      // self-hosted take the same step.
      key: 'workspaceUrl',
      type: 'input',
      label: t('CFG.WORKSPACE_URL', 'Workspace URL'),
      required: true,
      description: t(
        'CFG.WORKSPACE_URL_HELP',
        'Open your workspace in Plane and copy the address from your browser, e.g. ' +
          'https://app.plane.so/<workspace>/ or https://plane.example.com/<workspace>/',
      ),
    },
    {
      // Picked from a list, not typed: Plane's own "Project ID" setting is the short
      // identifier (e.g. `ACME`), not the UUID the API needs.
      key: 'projectId',
      type: 'select',
      label: t('CFG.PROJECT', 'Project'),
      required: true,
      loadOptions: loadProjectOptions,
    },
  ],

  // Reads only the key, so a not-yet-valid workspace URL cannot break request headers.
  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const { apiKey } = config as PlaneUserConfig;
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'X-API-Key': apiKey || '',
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

  // Probing the project validates the key and every part of the URL; `/users/me/`
  // would pass with a wrong slug or project and then import nothing.
  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      const cfg = asConfig(config);
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
