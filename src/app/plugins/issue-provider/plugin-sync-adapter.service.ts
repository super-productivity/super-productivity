import { IssueSyncAdapter } from '../../features/issue/two-way-sync/issue-sync-adapter.interface';
import {
  FieldMapping,
  FieldSyncConfig,
} from '../../features/issue/two-way-sync/issue-sync.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
} from './plugin-issue-provider.model';
import { Task } from '../../features/tasks/task.model';

const convertMapping = (pm: PluginFieldMapping): FieldMapping => ({
  taskField: pm.taskField,
  issueField: pm.issueField,
  defaultDirection: pm.defaultDirection,
  toIssueValue: pm.toIssueValue,
  toTaskValue: pm.toTaskValue,
  ...(pm.mutuallyExclusive
    ? { mutuallyExclusive: pm.mutuallyExclusive as (keyof Task)[] }
    : {}),
});

/**
 * Creates an IssueSyncAdapter for a specific plugin issue provider.
 * One instance is created per plugin that declares fieldMappings + updateIssue.
 */
export const createPluginSyncAdapter = (
  definition: IssueProviderPluginDefinition,
  createHttpHelper: (
    getHeaders: () => Record<string, string> | Promise<Record<string, string>>,
  ) => PluginHttp,
): IssueSyncAdapter<IssueProviderPluginType> => {
  const fieldMappings: FieldMapping[] = (definition.fieldMappings ?? []).map(
    convertMapping,
  );

  const createHttp = (cfg: IssueProviderPluginType): PluginHttp =>
    createHttpHelper(() => definition.getHeaders(cfg.pluginConfig));

  return {
    getFieldMappings: (): FieldMapping[] => fieldMappings,

    getSyncConfig: (cfg: IssueProviderPluginType): FieldSyncConfig => {
      const twoWay = cfg.pluginConfig?.['twoWaySync'] as
        | Record<string, string>
        | undefined;
      if (!twoWay) {
        return {};
      }
      const VALID_DIRECTIONS = new Set(['off', 'pullOnly', 'pushOnly', 'both']);
      const result: FieldSyncConfig = {};
      for (const m of fieldMappings) {
        const direction = twoWay[m.taskField];
        if (direction && VALID_DIRECTIONS.has(direction)) {
          result[m.taskField] = direction as FieldSyncConfig[keyof FieldSyncConfig];
        }
      }
      return result;
    },

    fetchIssue: async (
      issueId: string,
      cfg: IssueProviderPluginType,
    ): Promise<Record<string, unknown>> => {
      const http = createHttp(cfg);
      const issue = await definition.getById(issueId, cfg.pluginConfig, http);
      return issue as Record<string, unknown>;
    },

    pushChanges: async (
      issueId: string,
      changes: Record<string, unknown>,
      cfg: IssueProviderPluginType,
    ): Promise<void> => {
      if (!definition.updateIssue) {
        throw new Error('Plugin does not implement updateIssue');
      }
      const http = createHttp(cfg);
      await definition.updateIssue(issueId, changes, cfg.pluginConfig, http);
    },

    extractSyncValues: (issue: Record<string, unknown>): Record<string, unknown> => {
      if (definition.extractSyncValues) {
        return definition.extractSyncValues(
          issue as Parameters<
            NonNullable<IssueProviderPluginDefinition['extractSyncValues']>
          >[0],
        );
      }
      const result: Record<string, unknown> = {};
      for (const m of fieldMappings) {
        result[m.issueField] = issue[m.issueField];
      }
      return result;
    },

    createIssue: async (
      title: string,
      cfg: IssueProviderPluginType,
    ): Promise<{
      issueId: string;
      issueNumber?: number;
      issueData: Record<string, unknown>;
    }> => {
      if (!definition.createIssue) {
        throw new Error('Plugin does not implement createIssue');
      }
      const http = createHttp(cfg);
      const result = await definition.createIssue(title, cfg.pluginConfig, http);
      return {
        issueId: result.issueId,
        issueNumber: result.issueNumber,
        issueData: result.issueData as Record<string, unknown>,
      };
    },

    getIssueLastUpdated: (issue: Record<string, unknown>): number => {
      const lastUpdated = (issue as { lastUpdated?: number }).lastUpdated;
      return lastUpdated ?? Date.now();
    },

    deleteIssue: definition.deleteIssue
      ? async (issueId: string, cfg: IssueProviderPluginType): Promise<void> => {
          const http = createHttp(cfg);
          await definition.deleteIssue!(issueId, cfg.pluginConfig, http);
        }
      : undefined,
  };
};
