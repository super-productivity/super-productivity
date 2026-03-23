import type {
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

export const API_BASE = 'https://api.clickup.com/api/v2';
export const MAX_RETRIES = 3;

export interface ClickUpConfig {
  apiKey: string;
  teamIds?: string;
  userId?: string;
}

export interface ClickUpStatus {
  id?: string;
  status: string;
  type: string;
  orderindex: number;
  color: string;
}

export interface ClickUpUser {
  id: number;
  username?: string | null;
  color: string | null;
  email: string;
  profilePicture: string | null;
}

export interface ClickUpTag {
  name: string;
}

export interface ClickUpPriority {
  id: string;
  priority: string;
  color: string;
}

export interface ClickUpTaskReduced {
  id: string;
  name: string;
  status: ClickUpStatus;
  date_updated: string;
  url: string;
  custom_id?: string | null;
}

export interface ClickUpTask extends ClickUpTaskReduced {
  text_content?: string | null;
  description?: string | null;
  markdown_description?: string | null;
  date_created: string;
  date_closed: string | null;
  creator: ClickUpUser;
  assignees: ClickUpUser[];
  tags: ClickUpTag[];
  priority?: ClickUpPriority | null;
}

export interface ClickUpTeamsResponse {
  teams: Array<{ id: string; name: string }>;
}

export interface ClickUpUserResponse {
  user: { id: number; username?: string | null };
}

export interface ClickUpTaskSearchResponse {
  tasks: ClickUpTask[];
}

export const parseTeamIds = (config: ClickUpConfig): string[] => {
  if (!config.teamIds) return [];
  return config.teamIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export const mapSearchResult = (task: ClickUpTaskReduced): PluginSearchResult => ({
  id: task.id,
  title: task.name,
  url: task.url,
  // Use status.type (open/closed/custom) so _computeIsDone in the adapter works
  // for custom ClickUp closed statuses like "Shipped" or "Ready for QA"
  status: task.status.type,
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const getWithRetry = async <T>(
  http: PluginHttp,
  url: string,
  opts?: { params?: Record<string, string> },
): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await http.get<T>(url, opts);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status: number }).status === 429
      ) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error('ClickUp: Max retries exceeded');
};

export const searchTasksInTeam = async (
  searchTerm: string,
  teamId: string,
  config: ClickUpConfig,
  http: PluginHttp,
): Promise<ClickUpTaskReduced[]> => {
  const params: Record<string, string> = {
    page: '0',
    subtasks: 'true',
  };
  if (config.userId) {
    params['assignees[]'] = config.userId;
  }
  const response = await getWithRetry<ClickUpTaskSearchResponse>(
    http,
    `${API_BASE}/team/${teamId}/task`,
    { params },
  );
  let tasks = response.tasks || [];
  if (searchTerm.trim()) {
    const lower = searchTerm.toLowerCase();
    tasks = tasks.filter(
      (task) =>
        task.name.toLowerCase().includes(lower) ||
        (task.custom_id && task.custom_id.toLowerCase().includes(lower)) ||
        task.id.includes(lower),
    );
  }
  return tasks;
};

export const getTeamIds = async (
  config: ClickUpConfig,
  http: PluginHttp,
): Promise<string[]> => {
  const configured = parseTeamIds(config);
  if (configured.length > 0) return configured;

  const response = await getWithRetry<ClickUpTeamsResponse>(http, `${API_BASE}/team`);
  return (response.teams || []).map((team) => team.id);
};

export const mapTaskToPluginIssue = (task: ClickUpTask): PluginIssue => ({
  id: task.id,
  title: task.name,
  body: task.markdown_description || task.description || '',
  url: task.url,
  // Use status.type (open/closed/custom) so _computeIsDone in the adapter works
  // for custom ClickUp closed statuses like "Shipped" or "Ready for QA"
  state: task.status.type,
  lastUpdated: parseInt(task.date_updated, 10),
  assignee: task.assignees?.map((a) => a.username || a.email || 'Unknown').join(', '),
  labels: task.tags?.map((tag) => tag.name) || [],

  // Extended fields for display
  summary: task.name,
  statusName: task.status.status,
  statusType: task.status.type,
  priority: task.priority?.priority,
  description: task.markdown_description || task.description || '',
});
