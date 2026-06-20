import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

const API_VERSION = '6.0';
const DEFAULT_WORK_ITEM_LIMIT = 50;
const MAX_WORK_ITEM_LIMIT = 200;

// Work item fields fetched for the list views (kept identical to the built-in
// provider so behavior is unchanged after migration). getById fetches the full
// work item (no field filter) so it additionally returns System.Description.
const WORK_ITEM_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'Microsoft.VSTS.Common.Priority',
  'System.CreatedDate',
  'System.ChangedDate',
  'System.AssignedTo',
  'Microsoft.VSTS.Scheduling.DueDate',
  'Microsoft.VSTS.Scheduling.TargetDate',
  'Microsoft.VSTS.Scheduling.StartDate',
].join(',');

// Azure DevOps "done" state categories. The backlog query excludes
// Closed/Done/Removed; Resolved is the Agile resolved-but-not-closed state.
const DONE_STATES = ['closed', 'done', 'removed', 'resolved'];

type AzureScope = 'all' | 'created-by-me' | 'assigned-to-me';

interface AzureDevOpsConfig {
  host?: string;
  organization?: string;
  project?: string;
  token?: string;
  scope?: AzureScope;
  autoImportLimit?: number | string;
  autoImportWiql?: string;
}

// Azure DevOps work item fields use dotted names like 'System.Title'.
type AzureWorkItemFields = Record<string, unknown> & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'System.AssignedTo'?: { displayName?: string };
};

interface AzureWorkItem {
  id: number;
  fields: AzureWorkItemFields;
  _links?: { html?: { href?: string } };
}

interface AzureWorkItemsResponse {
  value: AzureWorkItem[];
}

interface AzureWiqlResponse {
  workItems?: { id: number }[];
}

const t = (key: string, params?: Record<string, string | number>): string => {
  try {
    return PluginAPI.translate(key, params);
  } catch {
    return key;
  }
};

const toMs = (date: unknown): number => {
  const str = typeof date === 'string' ? date : '';
  return str ? new Date(str).getTime() : 0;
};

// Azure DevOps Server (on-prem) uses a custom host; cloud falls back to the
// dev.azure.com/<org> URL the built-in provider built from `organization`.
const getBaseUrl = (cfg: AzureDevOpsConfig): string => {
  const host = cfg.host || `https://dev.azure.com/${cfg.organization || ''}`;
  return host.replace(/\/$/, '');
};

// WIQL has no parameter binding, so single quotes in user input are doubled to
// prevent breaking out of the string literal (matches the built-in provider).
const escapeWiql = (value: string | undefined): string =>
  (value || '').replace(/'/g, "''");

const clampLimit = (cfg: AzureDevOpsConfig): number => {
  const raw = Number(cfg.autoImportLimit);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WORK_ITEM_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_WORK_ITEM_LIMIT);
};

const summaryOf = (item: AzureWorkItem): string =>
  `${item.fields['System.WorkItemType']} ${item.id}: ${item.fields['System.Title']}`;

const dueOf = (fields: AzureWorkItemFields): string =>
  (fields['Microsoft.VSTS.Scheduling.DueDate'] as string | undefined) ||
  (fields['Microsoft.VSTS.Scheduling.TargetDate'] as string | undefined) ||
  (fields['Microsoft.VSTS.Scheduling.StartDate'] as string | undefined) ||
  '';

const mapReduced = (item: AzureWorkItem): PluginSearchResult => {
  const fields = item.fields;
  const summary = summaryOf(item);
  const due = dueOf(fields);
  return {
    id: String(item.id),
    title: summary,
    url: item._links?.html?.href,
    // is-issue-done reads `status` to strike through done items in the search
    // list. add-task leaves isDone unset (no `state` here), matching built-in.
    status: String(fields['System.State'] || ''),

    // Extended fields for display + add-task data.
    summary,
    assignee: fields['System.AssignedTo']?.displayName,
    lastUpdated: toMs(fields['System.ChangedDate']),
    priority: fields['Microsoft.VSTS.Common.Priority'] as number | undefined,
    due,
    // Built-in seeded dueWithTime from the work item's due/target/start date.
    ...(due ? { dueWithTime: new Date(due).getTime() } : {}),
  };
};

const mapIssue = (item: AzureWorkItem): PluginIssue => {
  const fields = item.fields;
  const summary = summaryOf(item);
  const due = dueOf(fields);
  return {
    id: String(item.id),
    title: summary,
    body: (fields['System.Description'] as string) || '',
    url: item._links?.html?.href,
    // `state` is the canonical status field — drives issueDisplay, fieldMappings
    // (isDone) and extractSyncValues.
    state: String(fields['System.State'] || ''),
    lastUpdated: toMs(fields['System.ChangedDate']),
    assignee: fields['System.AssignedTo']?.displayName,

    // Extended fields for display.
    summary,
    priority: fields['Microsoft.VSTS.Common.Priority'] as number | undefined,
    due,
  };
};

// Run a WIQL query (ids only), then batch-fetch the work item details — the two
// steps the Azure DevOps REST API requires (matches the built-in provider).
const runWiqlAndFetch = async (
  cfg: AzureDevOpsConfig,
  http: PluginHttp,
  query: string,
  limit: number,
): Promise<AzureWorkItem[]> => {
  const baseUrl = getBaseUrl(cfg);
  const wiql = await http.post<AzureWiqlResponse>(
    `${baseUrl}/${cfg.project}/_apis/wit/wiql?api-version=${API_VERSION}`,
    { query },
  );
  const refs = wiql?.workItems || [];
  if (!refs.length) {
    return [];
  }
  const ids = refs.map((r) => r.id).slice(0, limit);
  const res = await http.get<AzureWorkItemsResponse>(
    `${baseUrl}/${cfg.project}/_apis/wit/workitems`,
    {
      params: {
        ids: ids.join(','),
        fields: WORK_ITEM_FIELDS,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'api-version': API_VERSION,
      },
    },
  );
  return res?.value || [];
};

// Build the WIQL query used for auto backlog import. When the user provides a
// custom WIQL it fully replaces the generated query — they own scope, the state
// filter and ordering (e.g. to filter by iteration/area path or work item type,
// or to match custom done-state names). Empty -> the default scope-based query,
// fully backward compatible.
const backlogQuery = (cfg: AzureDevOpsConfig): string => {
  const custom = (cfg.autoImportWiql || '').trim();
  if (custom) {
    return custom;
  }
  const project = escapeWiql(cfg.project);
  // Default to the built-in's 'assigned-to-me' when scope is unset (the plugin
  // form has no default-value mechanism for selects).
  const scope: AzureScope = cfg.scope || 'assigned-to-me';
  let query =
    `Select [System.Id] From WorkItems Where [System.TeamProject] = '${project}' ` +
    `AND [System.State] <> 'Closed' AND [System.State] <> 'Done' AND [System.State] <> 'Removed'`;
  if (scope === 'assigned-to-me') {
    query += ` AND [System.AssignedTo] = @Me`;
  } else if (scope === 'created-by-me') {
    query += ` AND [System.CreatedBy] = @Me`;
  }
  return query;
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'host',
      type: 'input',
      label: t('CFG.HOST'),
      description: t('CFG.HOST_DESC'),
      required: true,
    },
    {
      key: 'project',
      type: 'input',
      label: t('CFG.PROJECT'),
      required: true,
    },
    {
      key: 'token',
      type: 'password',
      label: t('CFG.TOKEN'),
      required: true,
    },
    {
      key: 'scope',
      type: 'select',
      label: t('CFG.SCOPE'),
      advanced: true,
      options: [
        { value: 'all', label: t('CFG.SCOPE_ALL') },
        { value: 'created-by-me', label: t('CFG.SCOPE_CREATED') },
        { value: 'assigned-to-me', label: t('CFG.SCOPE_ASSIGNED') },
      ],
    },
    {
      key: 'autoImportLimit',
      type: 'input',
      label: t('CFG.AUTO_IMPORT_LIMIT'),
      description: t('CFG.AUTO_IMPORT_LIMIT_DESC', { max: MAX_WORK_ITEM_LIMIT }),
      advanced: true,
    },
    {
      key: 'autoImportWiql',
      type: 'textarea',
      label: t('CFG.AUTO_IMPORT_WIQL'),
      description: t('CFG.AUTO_IMPORT_WIQL_DESC'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as AzureDevOpsConfig;
    // Azure DevOps PAT auth: HTTP Basic with an empty username and the PAT as
    // the password. Content-Type is set globally for the WIQL POST body.
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${cfg.token || ''}`)}`,
    };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as AzureDevOpsConfig;
    const term = escapeWiql(searchTerm);
    const project = escapeWiql(cfg.project);
    let query =
      `Select [System.Id] From WorkItems Where [System.Title] Contains '${term}' ` +
      `AND [System.TeamProject] = '${project}'`;
    if (/^\d+$/.test(term)) {
      query =
        `Select [System.Id] From WorkItems Where ([System.Title] Contains '${term}' ` +
        `OR [System.Id] = ${term}) AND [System.TeamProject] = '${project}'`;
    }
    const items = await runWiqlAndFetch(cfg, http, query, DEFAULT_WORK_ITEM_LIMIT);
    return items.map(mapReduced);
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = config as unknown as AzureDevOpsConfig;
    const item = await http.get<AzureWorkItem>(
      `${getBaseUrl(cfg)}/${cfg.project}/_apis/wit/workitems/${issueId}?api-version=${API_VERSION}`,
    );
    return mapIssue(item);
  },

  // Azure DevOps work item URLs are derivable from host + project + id, so the
  // link is built without a request (the html href the API returns for an item).
  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const cfg = config as unknown as AzureDevOpsConfig;
    const baseUrl = getBaseUrl(cfg);
    if (!baseUrl || !cfg.project) {
      return '';
    }
    return `${baseUrl}/${cfg.project}/_workitems/edit/${issueId}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = config as unknown as AzureDevOpsConfig;
    try {
      await http.get(`${getBaseUrl(cfg)}/_apis/connectionData?api-version=5.1-preview`);
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as AzureDevOpsConfig;
    const query = backlogQuery(cfg);
    const items = await runWiqlAndFetch(cfg, http, query, clampLimit(cfg));
    return items.map(mapReduced);
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATUS'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'due', label: t('DISPLAY.DUE_DATE'), type: 'text', hideEmpty: true },
    { field: 'priority', label: t('DISPLAY.PRIORITY'), type: 'text', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  // Read-only provider: pull-only mapping drives remote-update detection only.
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue ? 'Closed' : 'Active'),
      toTaskValue: (issueValue: unknown): boolean =>
        DONE_STATES.includes(String(issueValue).toLowerCase()),
    },
  ] satisfies PluginFieldMapping[],

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      title: issue.title,
      body: issue.body,
    };
  },
} satisfies IssueProviderPluginDefinition as IssueProviderPluginDefinition);
