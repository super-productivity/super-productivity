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
  on(loadAllData, (oldState, { appDataComplete }) =>
    appDataComplete.issueProvider ? appDataComplete.issueProvider : oldState,
  ),
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
