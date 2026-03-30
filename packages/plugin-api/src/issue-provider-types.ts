// Public types for plugin authors who build issue provider plugins

import { OAuthFlowConfig } from './types';

export interface PluginSearchResult {
  id: string;
  title: string;
  url?: string;
  status?: string;
  assignee?: string;
  /** Event start timestamp (ms) - required for agenda view */
  start?: number;
  /** Precise due-with-time timestamp (ms) for timed events. When set, the task is
   *  created with dueWithTime instead of dueDay on initial import. */
  dueWithTime?: number;
  /** Event duration in milliseconds - used for calendar display */
  duration?: number;
  /** True if this is an all-day event */
  isAllDay?: boolean;
  /** Event description / body text */
  description?: string;
}

export interface PluginIssue {
  id: string;
  title: string;
  body?: string;
  url?: string;
  state?: string;
  lastUpdated?: number;
  assignee?: string;
  labels?: string[];
  comments?: PluginIssueComment[];
  [key: string]: unknown;
}

export interface PluginIssueComment {
  author: string;
  body: string;
  created: number;
  [key: string]: unknown;
}

export interface PluginIssueField {
  field: string;
  label: string;
  type?: 'text' | 'markdown' | 'link' | 'date' | 'list';
  /** For type 'link': field name on PluginIssue containing the URL */
  linkField?: string;
  /** Hide this field when its value is falsy */
  hideEmpty?: boolean;
}

export interface PluginCommentsConfig {
  authorField?: string;
  bodyField?: string;
  createdField?: string;
  avatarField?: string;
  sortField?: string;
}

export type PluginSyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both';

export interface PluginFieldMapping {
  taskField: 'isDone' | 'title' | 'notes' | 'dueDay' | 'dueWithTime' | 'timeEstimate';
  issueField: string;
  defaultDirection: PluginSyncDirection;
  /** Task fields to clear when this field is set (e.g. dueWithTime and dueDay are mutually exclusive) */
  mutuallyExclusive?: string[];
  toIssueValue(
    taskValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
  toTaskValue(
    issueValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
}

export interface PluginFormField {
  key: string;
  type:
    | 'input'
    | 'password'
    | 'textarea'
    | 'checkbox'
    | 'select'
    | 'multiSelect'
    | 'link'
    | 'oauthButton';
  label: string;
  required?: boolean;
  /** Help text shown below the field */
  description?: string;
  options?: { label: string; value: string }[];
  /** For type 'link': the URL to open */
  url?: string;
  /** Regex pattern for input validation */
  pattern?: string;
  /** Place this field in the collapsible "Advanced Config" section */
  advanced?: boolean;
  /** Only show this field when the specified config key is truthy */
  showIf?: string;
  /** For type 'oauthButton': OAuth flow configuration */
  oauthConfig?: OAuthFlowConfig;
  /** For type 'select': dynamically load options at runtime (e.g. after OAuth) */
  loadOptions?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ label: string; value: string }[]>;
}

export interface PluginHttpOptions {
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  /** Response type — 'json' (default) or 'text' for XML/iCal responses */
  responseType?: 'json' | 'text';
}

export interface PluginHttp {
  get<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  post<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  put<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  patch<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  delete<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  /** Send a request with an arbitrary HTTP method (e.g. PROPFIND, REPORT) */
  request<T = unknown>(
    method: string,
    url: string,
    body?: unknown,
    options?: PluginHttpOptions,
  ): Promise<T>;
}

export interface IssueProviderPluginDefinition {
  configFields: PluginFormField[];
  getHeaders(
    config: Record<string, unknown>,
  ): Record<string, string> | Promise<Record<string, string>>;
  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue>;
  getIssueLink(issueId: string, config: Record<string, unknown>): string;
  testConnection?(config: Record<string, unknown>, http: PluginHttp): Promise<boolean>;
  getNewIssuesForBacklog?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  issueDisplay: PluginIssueField[];
  commentsConfig?: PluginCommentsConfig;
  fieldMappings?: PluginFieldMapping[];
  updateIssue?(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  createIssue?(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber?: number; issueData: PluginIssue }>;
  extractSyncValues?(issue: PluginIssue): Record<string, unknown>;
  deleteIssue?(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  /** Issue states that indicate the issue was deleted remotely (e.g. ['cancelled'] for Google Calendar) */
  deletedStates?: string[];
  /** Optional time-block integration. Plugins that implement this allow SP tasks
   *  to automatically create/update/delete calendar events when scheduled to a specific time. */
  timeBlock?: {
    /** Create or update a time-block event for the given task. */
    upsertEvent(
      taskId: string,
      eventData: {
        title: string;
        dueWithTime: number;
        durationMs: number;
        isDone: boolean;
      },
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void>;
    /** Delete the time-block event for the given task. */
    deleteEvent(
      taskId: string,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void>;
  };
}

export interface IssueProviderManifestConfig {
  pollIntervalMs: number;
  icon: string;
  /** Short human-readable name for the issue provider (e.g. 'GitHub', 'ClickUp').
   * Used in UI chips and labels. Falls back to the plugin name if not set. */
  humanReadableName?: string;
  issueStrings?: { singular: string; plural: string };
  /** Show calendar-style agenda view instead of search-based list */
  useAgendaView?: boolean;
  /** Pre-select auto-import of new issues to backlog when creating this provider */
  defaultAutoAddToBacklog?: boolean;
  /** Custom issue provider key for migrated built-in providers (e.g. 'GITHUB').
   * When set, the plugin registers under this key instead of 'plugin:<pluginId>'. */
  issueProviderKey?: string;
  /** Allow requests to private/local network addresses (e.g. for self-hosted CalDAV).
   * Default is false — SSRF protections block private IPs and localhost. */
  allowPrivateNetwork?: boolean;
}
