import type { IssueProviderKey } from '../../features/issue/issue.model';
import type { IssueProviderPluginDefinition } from '@super-productivity/plugin-api';

export type {
  PluginSearchResult,
  PluginIssue,
  PluginIssueComment,
  PluginIssueField,
  PluginCommentsConfig,
  PluginSyncDirection,
  PluginFieldMapping,
  PluginFormField,
  PluginHttpOptions,
  PluginHttp,
  IssueProviderPluginDefinition,
} from '@super-productivity/plugin-api';

/**
 * Stored metadata for a registered plugin issue provider.
 * Combines the plugin definition with manifest-level metadata.
 */
export interface RegisteredPluginIssueProvider {
  pluginId: string;
  /** The key under which this provider is registered (e.g. 'plugin:my-plugin' or 'GITHUB') */
  registeredKey: IssueProviderKey;
  definition: IssueProviderPluginDefinition;
  name: string;
  /** Short human-readable name for UI display (e.g. 'GitHub'). Falls back to name. */
  humanReadableName: string;
  icon: string;
  pollIntervalMs: number;
  issueStrings: { singular: string; plural: string };
  useAgendaView?: boolean;
  defaultAutoAddToBacklog?: boolean;
}
