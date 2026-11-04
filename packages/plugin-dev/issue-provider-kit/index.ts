// Small helpers shared by the issue-provider plugins in packages/plugin-dev.
// Plugins import this file by relative path, so esbuild bundles (and
// tree-shakes) it into each plugin; it is NOT part of the public PluginAPI.
// Types come from plugin-api's source by path: this folder has no node_modules
// of its own when a plugin type-checks it, so the package name would not
// resolve. Only interfaces cross into plugins, which match structurally.
import type {
  IssueProviderPluginDefinition,
  PluginAPI as PluginAPIType,
  PluginCommentsConfig,
  PluginFieldMapping,
  PluginIssue,
} from '../../plugin-api/src/index';

declare const PluginAPI: PluginAPIType;

export const registerIssueProvider = (definition: IssueProviderPluginDefinition): void =>
  PluginAPI.registerIssueProvider(definition);

/** Translates a plugin i18n key, falling back to the key itself. */
export const t = (key: string, params?: Record<string, string | number>): string => {
  try {
    return PluginAPI.translate(key, params);
  } catch {
    return key;
  }
};

/** Types the untyped config record the host passes to every provider method. */
export const asConfig = <T>(config: Record<string, unknown>): T => config as unknown as T;

/** For `testConnection`: true when the request resolves (and passes `isOk`). */
export const canConnect = async (
  request: () => Promise<unknown>,
  isOk: (response: unknown) => boolean = () => true,
): Promise<boolean> => {
  try {
    return isOk(await request());
  } catch {
    return false;
  }
};

/** Epoch ms for an ISO date string; 0 for anything else (null, '', missing). */
export const toMs = (date: unknown): number =>
  typeof date === 'string' && date ? new Date(date).getTime() : 0;

/** `Authorization: token <token>` (GitHub/Gitea style); no header without a token. */
export const tokenAuth = (token: string | undefined): Record<string, string> =>
  token ? { Authorization: `token ${token}` } : {};

/** HTTP Basic credentials, UTF-8 encoded (`btoa` alone only accepts Latin-1). */
export const basicAuth = (username: string, password: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(`${username}:${password}`)) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
};

/** Comment fields as produced by the providers' `{ author, body, created, avatarUrl }` mapping. */
export const COMMENTS_CONFIG: PluginCommentsConfig = {
  authorField: 'author',
  bodyField: 'body',
  createdField: 'created',
  avatarField: 'avatarUrl',
};

/** Pull-only `isDone` mapping for a two-valued remote state field. */
export const isDoneMapping = ({
  issueField = 'state',
  done = 'closed',
  open = 'open',
  isDone = (value: unknown): boolean => value === done,
}: {
  issueField?: string;
  done?: string;
  open?: string;
  isDone?: (issueValue: unknown) => boolean;
} = {}): PluginFieldMapping => ({
  taskField: 'isDone',
  issueField,
  defaultDirection: 'pullOnly',
  toIssueValue: (taskValue: unknown): string => (taskValue ? done : open),
  toTaskValue: isDone,
});

/** Maps a text task field 1:1 to an issue field (missing → ''). */
export const textMapping = (
  taskField: PluginFieldMapping['taskField'],
  issueField: string,
  defaultDirection: PluginFieldMapping['defaultDirection'] = 'pullOnly',
): PluginFieldMapping => ({
  taskField,
  issueField,
  defaultDirection,
  toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
  toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
});

/** `extractSyncValues` that picks the given issue fields. */
export const pickSyncValues =
  (...fields: string[]) =>
  (issue: PluginIssue): Record<string, unknown> =>
    Object.fromEntries(fields.map((field) => [field, issue[field]]));
