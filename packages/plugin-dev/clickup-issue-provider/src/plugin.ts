import type {
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';
import {
  asConfig,
  canConnect,
  isDoneMapping,
  pickSyncValues,
  registerIssueProvider,
  t,
  textMapping,
} from '../../issue-provider-kit';
import {
  API_BASE,
  ClickUpConfig,
  ClickUpTask,
  ClickUpTaskReduced,
  ClickUpUserResponse,
  getTeamIds,
  getWithRetry,
  mapSearchResult,
  mapTaskToPluginIssue,
  searchTasksInTeam,
} from './clickup-api';

const fetchTasks = async (
  searchTerm: string,
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const cfg = asConfig<ClickUpConfig>(config);
  const teamIds = await getTeamIds(cfg, http);

  if (teamIds.length === 0) return [];

  const settled = await Promise.allSettled(
    teamIds.map((teamId) => searchTasksInTeam(searchTerm, teamId, cfg, http)),
  );

  const rejected = settled.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (rejected.length > 0) {
    console.warn(
      `ClickUp: ${rejected.length} team search(es) failed`,
      rejected.map((r) => r.reason),
    );
  }

  return settled
    .filter(
      (r): r is PromiseFulfilledResult<ClickUpTaskReduced[]> => r.status === 'fulfilled',
    )
    .flatMap((r) => r.value)
    .map(mapSearchResult);
};

registerIssueProvider({
  configFields: [
    {
      key: 'apiKey',
      type: 'password',
      label: t('CFG.API_KEY'),
      required: true,
    },
    {
      key: 'apiKeyLink',
      type: 'link',
      label: t('CFG.API_KEY_LINK'),
      url: 'https://app.clickup.com/settings/apps',
    },
    {
      key: 'teamIds',
      type: 'input',
      label: t('CFG.TEAM_IDS'),
      required: false,
      advanced: true,
    },
    {
      key: 'userId',
      type: 'input',
      label: t('CFG.USER_ID'),
      required: false,
      advanced: true,
    },
  ],

  getHeaders: (config) => ({
    'Content-Type': 'application/json',
    Authorization: asConfig<ClickUpConfig>(config).apiKey || '',
  }),

  searchIssues: (searchTerm, config, http) => fetchTasks(searchTerm, config, http),

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const params: Record<string, string> = {
      include_markdown_description: 'true',
      include_subtasks: 'true',
    };
    const task = await getWithRetry<ClickUpTask>(http, `${API_BASE}/task/${issueId}`, {
      params,
    });
    return mapTaskToPluginIssue(task);
  },

  getIssueLink(issueId: string, _config: Record<string, unknown>): string {
    return `https://app.clickup.com/t/${issueId}`;
  },

  testConnection: (_config, http) =>
    canConnect(() => getWithRetry<ClickUpUserResponse>(http, `${API_BASE}/user`)),

  getNewIssuesForBacklog: (config, http) => fetchTasks('', config, http),

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'statusName', label: t('DISPLAY.STATUS'), type: 'text' },
    { field: 'priority', label: t('DISPLAY.PRIORITY'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'description', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  fieldMappings: [
    isDoneMapping({ issueField: 'statusType' }),
    textMapping('title', 'title'),
  ],

  extractSyncValues: pickSyncValues('statusType', 'title'),
});
