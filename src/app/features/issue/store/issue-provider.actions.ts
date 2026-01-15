import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { IssueProvider } from '../issue.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

/* eslint-disable @typescript-eslint/naming-convention */

export const IssueProviderActions = createActionGroup({
  source: 'IssueProvider/API',
  events: {
    // Loading action - no persistence (hydrating state)
    'Load IssueProviders': props<{ issueProviders: IssueProvider[] }>(),

    'Add IssueProvider': (providerProps: { issueProvider: IssueProvider }) => ({
      ...providerProps,
      meta: {
        isPersistent: true,
        entityType: 'ISSUE_PROVIDER',
        entityId: providerProps.issueProvider.id,
        opType: OpType.Create,
      } satisfies PersistentActionMeta,
    }),

    // Upsert is typically used for sync/import, so no persistence metadata
    'Upsert IssueProvider': props<{ issueProvider: IssueProvider }>(),

    // Bulk add is typically used for sync/import, so no persistence metadata
    'Add IssueProviders': props<{ issueProviders: IssueProvider[] }>(),

    // Bulk upsert is typically used for sync/import, so no persistence metadata
    'Upsert IssueProviders': props<{ issueProviders: IssueProvider[] }>(),

    'Update IssueProvider': (providerProps: {
      issueProvider: Update<IssueProvider>;
    }) => ({
      ...providerProps,
      meta: {
        isPersistent: true,
        entityType: 'ISSUE_PROVIDER',
        entityId: providerProps.issueProvider.id as string,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // Bulk update is typically used for sync/import, so no persistence metadata
    'Update IssueProviders': props<{ issueProviders: Update<IssueProvider>[] }>(),

    'Sort IssueProviders First': (providerProps: { ids: string[] }) => ({
      ...providerProps,
      meta: {
        isPersistent: true,
        entityType: 'ISSUE_PROVIDER',
        entityIds: providerProps.ids,
        opType: OpType.Move,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    // Internal cleanup action - no persistence
    'Clear IssueProviders': emptyProps(),
  },
});
