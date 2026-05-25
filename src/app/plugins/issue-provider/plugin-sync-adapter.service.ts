import { IssueSyncAdapter } from '../../features/issue/two-way-sync/issue-sync-adapter.interface';
import {
  FieldMapping,
  FieldSyncConfig,
  SyncDirection,
} from '../../features/issue/two-way-sync/issue-sync.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
} from './plugin-issue-provider.model';
import { Task } from '../../features/tasks/task.model';
import { TagService } from '../../features/tag/tag.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { sortTagLabels } from './plugin-tag-utils';

const normalizeSyncDirectionForCapabilities = (
  direction: SyncDirection,
  isPushSupported: boolean,
): SyncDirection =>
  !isPushSupported && (direction === 'pushOnly' || direction === 'both')
    ? 'pullOnly'
    : direction;

const convertMapping = (
  pm: PluginFieldMapping,
  tagService: TagService,
  isPushSupported: boolean,
): FieldMapping => {
  if (pm.taskField === 'tagIds') {
    return {
      taskField: pm.taskField,
      issueField: pm.issueField,
      defaultDirection: normalizeSyncDirectionForCapabilities(
        pm.defaultDirection,
        isPushSupported,
      ),
      toIssueValue: (taskValue: unknown, ctx): unknown => {
        const tagIds = (taskValue as string[]) || [];
        const allTags = tagService.tags();
        // Defensive: TODAY_TAG is virtual (rule 5) and must never reach a
        // provider as a label. Filter the id out entirely — falling back
        // to id-as-label below would push the literal "TODAY".
        const labels = tagIds
          .filter((id) => id !== TODAY_TAG.id)
          .map((id) => allTags.find((t) => t.id === id)?.title || id)
          .sort();
        return pm.toIssueValue(labels, ctx);
      },
      toTaskValue: pm.toTaskValue,
      ...(pm.mutuallyExclusive
        ? { mutuallyExclusive: pm.mutuallyExclusive as (keyof Task)[] }
        : {}),
    };
  }

  return {
    taskField: pm.taskField,
    issueField: pm.issueField,
    defaultDirection: normalizeSyncDirectionForCapabilities(
      pm.defaultDirection,
      isPushSupported,
    ),
    toIssueValue: pm.toIssueValue,
    toTaskValue: pm.toTaskValue,
    ...(pm.mutuallyExclusive
      ? { mutuallyExclusive: pm.mutuallyExclusive as (keyof Task)[] }
      : {}),
  };
};

/**
 * Creates an IssueSyncAdapter for a specific plugin issue provider.
 * One instance is created per plugin that declares issue side effects.
 */
export const createPluginSyncAdapter = (
  definition: IssueProviderPluginDefinition,
  createHttpHelper: (
    getHeaders: () => Record<string, string> | Promise<Record<string, string>>,
  ) => PluginHttp,
  tagService: TagService,
): IssueSyncAdapter<IssueProviderPluginType> => {
  const isPushSupported = !!definition.updateIssue;
  const fieldMappings: FieldMapping[] = (definition.fieldMappings ?? []).map((pm) =>
    convertMapping(pm, tagService, isPushSupported),
  );

  const tagIssueFields = new Set(
    fieldMappings.filter((m) => m.taskField === 'tagIds').map((m) => m.issueField),
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
          result[m.taskField] = normalizeSyncDirectionForCapabilities(
            direction as SyncDirection,
            isPushSupported,
          ) as FieldSyncConfig[keyof FieldSyncConfig];
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
      const data = definition.extractSyncValues
        ? definition.extractSyncValues(
            issue as Parameters<
              NonNullable<IssueProviderPluginDefinition['extractSyncValues']>
            >[0],
          )
        : issue;

      const result: Record<string, unknown> = {};
      for (const m of fieldMappings) {
        const value = Object.prototype.hasOwnProperty.call(data, m.issueField)
          ? data[m.issueField]
          : issue[m.issueField];
        if (value === undefined) {
          continue;
        }
        if (tagIssueFields.has(m.issueField)) {
          result[m.issueField] = sortTagLabels(value);
        } else {
          result[m.issueField] = value;
        }
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
