import { createFeature, createReducer, on } from '@ngrx/store';
import { IssueProvider, IssueProviderState } from '../issue.model';
import { IssueProviderActions } from './issue-provider.actions';
import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

export const ISSUE_PROVIDER_FEATURE_KEY = 'issueProvider';

export const adapter: EntityAdapter<IssueProvider> = createEntityAdapter<IssueProvider>();

export const issueProviderInitialState: IssueProviderState = adapter.getInitialState({
  ids: [] as string[],
  // additional entity state properties
});

export const issueProviderReducer = createReducer(
  issueProviderInitialState,

  // META ACTIONS
  // ------------
  on(loadAllData, (oldState, { appDataComplete }) => {
    if (!appDataComplete.issueProvider) {
      return oldState;
    }
    const state = appDataComplete.issueProvider;
    // Migrate pre-plugin GITHUB providers to plugin shape
    const migratedEntities: Record<string, IssueProvider> = {};
    let needsMigration = false;
    for (const id of state.ids) {
      const provider = state.entities[id] as unknown as
        | Record<string, unknown>
        | undefined;
      if (
        provider &&
        provider['issueProviderKey'] === 'GITHUB' &&
        !provider['pluginConfig']
      ) {
        needsMigration = true;
        // TODO: Remove legacy field preservation after a few releases (added v17.3).
        // Spread original provider so legacy fields (repo, token, etc.) survive
        // for older clients that haven't upgraded yet.
        migratedEntities[id] = {
          ...provider,
          pluginId: 'github-issue-provider',
          pluginConfig: {
            repo: provider['repo'] ?? '',
            token: provider['token'] ?? '',
            filterUsername: provider['filterUsernameForIssueUpdates'] ?? '',
            backlogQuery: provider['backlogQuery'] ?? '',
            twoWaySync: provider['twoWaySync'] ?? {},
            isAutoCreateIssues: provider['isAutoCreateIssues'] ?? false,
          },
        } as unknown as IssueProvider;
      }

      // Migrate pre-plugin CLICKUP providers to plugin shape
      if (
        provider &&
        provider['issueProviderKey'] === 'CLICKUP' &&
        !provider['pluginConfig']
      ) {
        needsMigration = true;
        const teamIds = provider['teamIds'] as string[] | undefined;
        // TODO: Remove legacy field preservation after a few releases.
        // Spread original provider so legacy fields (apiKey, teamIds, etc.) survive
        // for older clients that haven't upgraded yet.
        migratedEntities[id] = {
          ...provider,
          pluginId: 'clickup-issue-provider',
          pluginConfig: {
            apiKey: provider['apiKey'] ?? '',
            teamIds: teamIds?.length ? teamIds.join(',') : '',
            userId: provider['userId'] != null ? String(provider['userId']) : '',
          },
        } as unknown as IssueProvider;
      }
    }
    if (!needsMigration) {
      return state;
    }
    return {
      ...state,
      entities: { ...state.entities, ...migratedEntities },
    };
  }),
  on(TaskSharedActions.deleteProject, (state, { projectId }) =>
    adapter.updateMany(
      state.ids
        .map((id) => state.entities[id])
        .filter((ip) => ip?.defaultProjectId === projectId)
        .map((ip) => ({ id: ip!.id, changes: { defaultProjectId: null } })),
      state,
    ),
  ),
  on(TaskSharedActions.deleteIssueProvider, (state, { issueProviderId }) =>
    adapter.removeOne(issueProviderId, state),
  ),
  on(TaskSharedActions.deleteIssueProviders, (state, { ids }) =>
    adapter.removeMany(ids, state),
  ),
  // -----------

  on(IssueProviderActions.addIssueProvider, (state, action) =>
    adapter.addOne(action.issueProvider, state),
  ),
  on(IssueProviderActions.upsertIssueProvider, (state, action) =>
    adapter.upsertOne(action.issueProvider, state),
  ),
  on(IssueProviderActions.addIssueProviders, (state, action) =>
    adapter.addMany(action.issueProviders, state),
  ),
  on(IssueProviderActions.upsertIssueProviders, (state, action) =>
    adapter.upsertMany(action.issueProviders, state),
  ),
  on(IssueProviderActions.updateIssueProvider, (state, action) =>
    adapter.updateOne(action.issueProvider, state),
  ),
  on(IssueProviderActions.updateIssueProviders, (state, action) =>
    adapter.updateMany(action.issueProviders, state),
  ),
  on(IssueProviderActions.loadIssueProviders, (state, action) =>
    adapter.setAll(action.issueProviders, state),
  ),

  on(IssueProviderActions.sortIssueProvidersFirst, (state, action) => ({
    ...state,
    ids: [...action.ids, ...state.ids.filter((id) => !action.ids.includes(id))],
  })),

  on(IssueProviderActions.clearIssueProviders, (state) => adapter.removeAll(state)),
);

export const issueProvidersFeature = createFeature({
  name: ISSUE_PROVIDER_FEATURE_KEY,
  reducer: issueProviderReducer,
  extraSelectors: ({ selectIssueProviderState }) => ({
    ...adapter.getSelectors(selectIssueProviderState),
  }),
});
