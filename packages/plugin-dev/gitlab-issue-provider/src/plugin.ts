import type {
  PluginHttp,
  PluginIssue,
  PluginIssueComment,
  PluginSearchResult,
  PluginTimeEntry,
} from '@super-productivity/plugin-api';
import {
  asConfig,
  canConnect,
  COMMENTS_CONFIG,
  registerIssueProvider,
  t,
  toMs,
} from '../../issue-provider-kit';

/* eslint-disable @typescript-eslint/naming-convention */

const DEFAULT_BASE_URL = 'https://gitlab.com/';
const PER_PAGE = 100;
// shortcut: GitLab's pagination headers are not exposed by the plugin http helper, so we
// page by "short page = last page". The cap keeps a huge project from stalling a poll;
// 50 x 100 = 5000 items. Raise it if a project really needs more.
const MAX_PAGES = 50;
const TOKEN_HELP_URL =
  'https://github.com/super-productivity/super-productivity/blob/master/docs/gitlab-access-token-instructions.md';

// A GitLab project reference is EITHER a numeric project ID OR a namespace-qualified
// path (`group/project`, subgroups, or the `%2F`-encoded form) — the REST API has no
// way to resolve a project by a bare slug, so a single-segment name like `test_config`
// always 404s at poll time (#8665). Require a path separator (`/` or `%2F`) for the
// non-numeric branch so that mistake gets inline feedback instead. Still permissive
// about the segment chars (e.g. consecutive hyphens, which GitLab paths allow) to
// avoid false-rejecting valid paths; the separator lookahead keeps the char class a
// single unnested quantifier (no catastrophic backtracking).
//
// This pattern's `.source` is handed to the config form's `pattern` option, which both feeds
// Angular's `Validators.pattern` AND is written verbatim to the native `<input pattern>`
// attribute. Chromium compiles that attribute with the RegExp `v` flag, under which `/`
// and `-` are reserved inside a character class and MUST be escaped — hence `[\w.%\/\-]`.
// It must also stay flag-independent (the attribute cannot carry an `i` flag, and a
// stringified `/…/i` RegExp is not a valid attribute value), so the only case-sensitive
// literal, the encoded separator, is written explicitly as `%2[Ff]`. Getting this wrong
// makes Chromium log "Invalid regular expression" on every change-detection cycle (#9034).
const GITLAB_PROJECT_REGEX = /^(?:[1-9][0-9]*|(?=.*(?:\/|%2[Ff]))[\w.%\/\-]+)$/;

// Same `v`-flag constraints as above; the legacy pattern's `i` flag is dropped, so an
// upper-case scheme or "LOCALHOST" is no longer accepted.
const BASE_URL_PATTERN =
  '^(https?:\\/\\/)?(localhost|[\\w.\\-]+(?:\\.[\\w.\\-]+)+)(:\\d+)?(\\/[^\\s]*)?$';

type GitlabScope = 'all' | 'created-by-me' | 'assigned-to-me';

interface GitlabConfig {
  project?: string;
  token?: string;
  gitlabBaseUrl?: string;
  scope?: GitlabScope;
  filterUsername?: string;
  filter?: string;
  isSubmitWorklogOnFinishDay?: boolean;
}

interface GitlabUser {
  username: string;
  name: string;
  avatar_url?: string;
  web_url?: string;
}

interface GitlabApiIssue {
  iid: number;
  title: string;
  description?: string | null;
  // GitLab reports 'opened' | 'closed' (the legacy typings said 'open')
  state: string;
  weight?: number | null;
  created_at: string;
  updated_at: string;
  labels?: string[];
  assignee?: GitlabUser | null;
  due_date?: string | null;
  web_url: string;
  references: { full: string };
}

interface GitlabApiNote {
  body: string;
  created_at: string;
  author?: GitlabUser | null;
}

interface GitlabTimeStats {
  total_time_spent?: number | null;
}

const hasProject = (cfg: GitlabConfig): cfg is GitlabConfig & { project: string } =>
  !!cfg.project;

const assertProject = (cfg: GitlabConfig): string => {
  if (!cfg.project) {
    throw new Error('GitLab project is not configured.');
  }
  return cfg.project;
};

// Tolerates a missing trailing slash and a missing scheme.
const getBaseUrl = (cfg: GitlabConfig): string => {
  const raw = (cfg.gitlabBaseUrl || '').trim() || DEFAULT_BASE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
};

const projectApiUrl = (cfg: GitlabConfig, project: string): string =>
  `${getBaseUrl(cfg)}api/v4/projects/${project.replace(/\//g, '%2F')}`;

/*
 * We use `references.full` ("johannesjo/test-repo#44") as the issue id: the numeric
 * `id` is an internal GitLab id that is of little use with the API, while `iid` alone
 * is only unique per project. Existing tasks store this id as `issueId`.
 */
const parseIssueId = (issueId: string): { project: string; iid: string } => {
  const [project, iid] = issueId.split('#');
  if (!project || !iid) {
    throw new Error('Cannot parse GitLab project and issueId');
  }
  return { project, iid };
};

const issueApiUrl = (cfg: GitlabConfig, issueId: string): string => {
  const { project, iid } = parseIssueId(issueId);
  return `${projectApiUrl(cfg, project)}/issues/${iid}`;
};

// The filter is a raw query fragment (`key=val&key2=val2`), so only the fragment
// delimiter is escaped: a literal "#" (e.g. a `C#` label) would otherwise cut off
// every parameter after it (#10151).
const customFilterQuery = (cfg: GitlabConfig): string =>
  cfg.filter ? `&${cfg.filter.replace(/#/g, '%23')}` : '';

const scopeQuery = (cfg: GitlabConfig): string =>
  cfg.scope ? `&scope=${cfg.scope}` : '';

// Local midnight of a GitLab `due_date` (YYYY-MM-DD); the host turns `start` into the
// task's dueDay on creation only, like the built-in provider.
const dueDateToStart = (dueDate: string | null | undefined): number | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate || '');
  return match ? new Date(+match[1], +match[2] - 1, +match[3]).getTime() : undefined;
};

// `state` (GitLab: 'opened' | 'closed') drives isDone on add via the host's default done
// states. No `doneStates`/isDone mapping on purpose: the built-in provider never pulled
// done-ness on refresh (#9909), and without `doneStates` the host keeps the task's isDone.
const mapIssue = (issue: GitlabApiIssue): PluginIssue => ({
  id: issue.references.full,
  title: `#${issue.iid} ${issue.title}`,
  body: issue.description || '',
  url: issue.web_url,
  state: issue.state,
  lastUpdated: toMs(issue.updated_at),
  assignee: issue.assignee?.username,
  labels: issue.labels ?? [],
  comments: [],
  number: issue.iid,
  assigneeUrl: issue.assignee?.web_url || '',
  points: issue.weight ?? undefined,
  start: dueDateToStart(issue.due_date),
});

const mapNote = (note: GitlabApiNote): PluginIssueComment => ({
  author: note.author?.username || 'unknown',
  body: note.body || '',
  created: toMs(note.created_at),
  avatarUrl: note.author?.avatar_url,
});

const getPage = async <T>(url: string, page: number, http: PluginHttp): Promise<T[]> => {
  const res = await http.get<T[]>(url, {
    params: { per_page: String(PER_PAGE), page: String(page) },
  });
  return Array.isArray(res) ? res : [];
};

const getAllPages = async <T>(url: string, http: PluginHttp): Promise<T[]> => {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getPage<T>(url, page, http);
    all.push(...batch);
    if (batch.length < PER_PAGE) {
      break;
    }
  }
  return all;
};

// Only the first page and no notes: a broad or empty search can match thousands of
// issues, and a /notes request per issue got GitLab to rate-limit us with a 429 (#9034).
const searchFirstPage = async (
  term: string,
  cfg: GitlabConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const url = `${projectApiUrl(cfg, assertProject(cfg))}/issues?search=${encodeURIComponent(term)}${scopeQuery(cfg)}&order_by=updated_at${customFilterQuery(cfg)}`;
  const issues = await getPage<GitlabApiIssue>(url, 1, http);
  return issues.map(mapIssue) as PluginSearchResult[];
};

// duration format is without spaces, e.g. "1h23m"; seconds are dropped like the
// built-in dialog did. Empty for anything under one minute.
const toGitlabDuration = (ms: number): string => {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours > 0 ? `${hours}h` : ''}${minutes > 0 ? `${minutes}m` : ''}`;
};

registerIssueProvider({
  configFields: [
    {
      key: 'project',
      type: 'input',
      label: t('CFG.PROJECT'),
      description: t('CFG.PROJECT_HINT'),
      required: true,
      pattern: GITLAB_PROJECT_REGEX.source,
    },
    { key: 'token', type: 'password', label: t('CFG.TOKEN'), required: true },
    {
      key: 'tokenHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: TOKEN_HELP_URL,
    },
    {
      key: 'scope',
      type: 'select',
      label: t('CFG.SCOPE'),
      required: true,
      advanced: true,
      options: [
        { value: 'all', label: t('CFG.SCOPE_ALL') },
        { value: 'created-by-me', label: t('CFG.SCOPE_CREATED') },
        { value: 'assigned-to-me', label: t('CFG.SCOPE_ASSIGNED') },
      ],
    },
    {
      key: 'gitlabBaseUrl',
      type: 'input',
      label: t('CFG.GITLAB_BASE_URL'),
      pattern: BASE_URL_PATTERN,
      advanced: true,
    },
    {
      key: 'filterUsername',
      type: 'input',
      label: t('CFG.FILTER_USER'),
      description: t('CFG.FILTER_USER_DESC'),
      advanced: true,
    },
    {
      key: 'filter',
      type: 'input',
      label: t('CFG.FILTER'),
      description: t('CFG.FILTER_DESCRIPTION'),
      advanced: true,
    },
    // Well-known key read by the host's finish-day worklog dialog (see `timeTracking`)
    {
      key: 'isSubmitWorklogOnFinishDay',
      type: 'checkbox',
      label: t('CFG.SUBMIT_TIMELOGS'),
      description: t('CFG.SUBMIT_TIMELOGS_DESCRIPTION'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const { token } = asConfig<GitlabConfig>(config);
    return token ? { 'PRIVATE-TOKEN': token } : {};
  },

  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return searchFirstPage(searchTerm, asConfig<GitlabConfig>(config), http);
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asConfig<GitlabConfig>(config);
    const url = issueApiUrl(cfg, issueId);
    const issue = await http.get<GitlabApiIssue>(url);
    // Always loaded (incl. system notes): user_notes_count excludes system notes.
    const notes = await getAllPages<GitlabApiNote>(`${url}/notes`, http);
    return { ...mapIssue(issue), comments: notes.map(mapNote) };
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const cfg = asConfig<GitlabConfig>(config);
    if (!hasProject(cfg)) {
      return '';
    }
    // 'project/repo#123' or '#123' -> '123'
    const iid = issueId.toString().replace(/^.*#/, '');
    return `${getBaseUrl(cfg)}${cfg.project}/-/issues/${iid}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = asConfig<GitlabConfig>(config);
    return canConnect(() => searchFirstPage('', cfg, http), Array.isArray);
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asConfig<GitlabConfig>(config);
    const url = `${projectApiUrl(cfg, assertProject(cfg))}/issues?state=opened&order_by=updated_at${scopeQuery(cfg)}${customFilterQuery(cfg)}`;
    const issues = await getAllPages<GitlabApiIssue>(url, http);
    return issues.map(mapIssue) as PluginSearchResult[];
  },

  issueDisplay: [
    { field: 'title', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATE'), type: 'text' },
    {
      field: 'assignee',
      label: t('DISPLAY.ASSIGNEE'),
      type: 'link',
      linkField: 'assigneeUrl',
      hideEmpty: true,
    },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown', hideEmpty: true },
  ],

  commentsConfig: COMMENTS_CONFIG,

  timeTracking: {
    // GitLab cannot date a time entry (it stamps the server's "now"), so
    // `entry.started` is ignored.
    async logTime(
      issueId: string,
      entry: PluginTimeEntry,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void> {
      const duration = toGitlabDuration(entry.timeSpentMs);
      if (!duration) {
        // nothing GitLab can record; the built-in dialog never submitted < 1 min either
        return;
      }
      await http.post(
        `${issueApiUrl(asConfig<GitlabConfig>(config), issueId)}/add_spent_time`,
        {
          duration,
          summary:
            entry.comment ||
            `Submitted via Super Productivity on ${new Date().toString()}`,
        },
      );
    },

    async getTimeLogged(
      issueId: string,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<number> {
      const stats = await http.get<GitlabTimeStats>(
        `${issueApiUrl(asConfig<GitlabConfig>(config), issueId)}/time_stats`,
      );
      return typeof stats?.total_time_spent === 'number'
        ? stats.total_time_spent * 1000
        : 0;
    },
  },
});
